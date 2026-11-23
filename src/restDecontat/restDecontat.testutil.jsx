// Harness-ul comun al testelor „Rest de decontat” (PR3): (1) constructorul de fișiere F3 .docx SINTETICE (structura reală a situației de plată
// Transgaz, ca în parsareSituatie.test.js; coduri / prețuri / denumiri inventate — repo public); (2) clientul Supabase FALS (tabele / vederi în
// memorie, lanțul eq / gt / order / limit / range + count, plafonul de rânduri al serverului, RPC-uri înregistrate; Storage-ul ARUNCĂ la orice
// atingere: ecranul nu urcă fișiere, r2); (3) montarea unei componente reale cu react-dom în jsdom. jsdom nu e dependență a proiectului (nu e
// în package-lock, nu se adaugă fără acord): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el suitele de ecran PICĂ EXPLICIT (r2,
// verdict #1178: nu se mai sar). Fără rețea, fără librării noi.
import React from 'react'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

export let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
export const MOTIV_LIPSA = 'LIPSEȘTE jsdom: testele de ecran ale „Rest de decontat” nu se sar. jsdom nu e dependență a proiectului (nu e în package-lock); '
  + 'rulați cu REDARI_JSDOM_DIR=<folder cu jsdom instalat> sau cereți acordul să fie adăugat ca devDependency.'
/** describe pentru suitele de ecran: cu jsdom = suita; fără jsdom = un test care PICĂ cu motivul (nu describe.skip) */
export const domObligatoriu = (nume, fn) => (JSDOM ? describe(nume, fn) : describe(nume, () => { it('jsdom e obligatoriu pentru testele de ecran', () => { throw new Error(MOTIV_LIPSA) }) }))

// ── (1) fișierele F3 sintetice ──
const SEP = '================================================================='
const ANTET_TABEL = ['= NR. SIMBOL ART. CANTITATE UM PU MAT VAL MAT =', '= D E N U M I R E PU MAN VAL MAN =', '= A R T I C O L PU UTI VAL UTI =', '= PU TRA VAL TRA =', '= SPOR MAT MAN UTI GR./UA GR.TOT. T O T A L =']
const f2 = x => x.toFixed(2), f3 = x => x.toFixed(3)
const mii = x => { const [i, z] = f2(Math.abs(x)).split('.'); return `${x < 0 ? '-' : ''}${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${z}` }
/** un deviz F3: { obiect, deviz, luna, an, articole: [{ nr, cod, um, cant, denumire, total }], totalGeneral } (controlul = suma „Total=”) */
export function devizF3({ obiect = '0001', deviz = 'DZ0101', luna = 10, an = 2026, articole, totalGeneral = null, situatie = true }) {
  const suma = Math.round(articole.reduce((s, a) => s + a.total, 0) * 100) / 100
  const p = ['Obiectivul: 0999 700000001 CONDUCTA DE TEST', `Obiectul: ${obiect} 45000000 TRONSON DE TEST`, ...(situatie ? [`Situatie de plata in luna ${luna} anul ${an}`] : []),
    `Deviz ${deviz} 4.1.1/1 Lucrari de test`, 'Categoria de lucrari: 0999', 'Preturi de contractare. Preturile sunt exprimate in RON', SEP, ...ANTET_TABEL, SEP]
  for (const a of articole) {
    p.push(`${a.nr} ${a.cod} ${a.um} ${f3(a.cant)} 0.00 0.00`, `${a.denumire || 'LUCRARE DE TEST'} 0.00 0.00`, '0.00 0.00', '0.00 0.00', `0.001 0 Total= ${f2(a.total)}`)
  }
  const tg = totalGeneral ?? Math.round(suma * 1.134 * 100) / 100
  p.push('Cheltuieli directe din articole:', 'GREUTATE MATERIALE MANOPERA UTILAJ TRANSPORT TOTAL', `0.021 ${f2(suma / 2)} ${f2(suma / 2)} 0.00 0.00 ${f2(suma)}`,
    'Total cheltuieli directe:', `TOTAL GENERAL DEVIZ: ${mii(tg)}`, `TOTAL cu TVA ${mii(tg * 1.21)}`, 'EXECUTANT BENEFICIAR', 'INTOCMIT VERIFICAT')
  return p
}
export async function docxDin(paragrafe) {
  const zip = new JSZip()
  const body = paragrafe.map(p => `<w:p><w:r><w:t xml:space="preserve">${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`).join('')
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
  return zip.generateAsync({ type: 'arraybuffer' })
}
/** un „File” de browser minimal (nume + arrayBuffer) */
export const fisierF3 = async (nume, paragrafe) => { const buf = await docxDin(paragrafe); return { name: nume, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', arrayBuffer: async () => buf.slice(0) } }

// ── datele false ale tab-ului: rânduri ca în v_executie_rest_decontat (bani + cantități pe articol) și v_executie_rest_decontat_obiect ──
export const A = (cheie, extra) => ({
  proiect_id: 1, rand_id: `1:${cheie}`, cheie, tip_rand: 'articol', obiect_cod: cheie.split('|')[0], obiect_nume: 'OB ' + cheie.split('|')[0], deviz_cod: cheie.split('|')[1],
  deviz_nume: 'DEVIZ', nr: null, cod: cheie.split('|')[2], denumire: 'LUCRARE ' + cheie.split('|')[2], um: 'M', um_incert: false, pret_unitar: 10,
  baza_cantitate: 100, baza_valoare: 1000, decontat_cantitate: 50, decontat_valoare: 500, rest_cantitate: 50, rest_valoare: 500, pct_decontat: 50,
  peste_oferta: false, nedecontat: false, situatii: 1, ultima_situatie: 'SL 1', ...extra,
})
export const ARTICOLE = [
  A('0001|D1|C1'),
  A('0001|D1|C2', { decontat_cantitate: 120, decontat_valoare: 1200, rest_cantitate: -20, rest_valoare: -200, pct_decontat: 120, peste_oferta: true }),
  A('0002|D2|C3', { decontat_cantitate: 0, decontat_valoare: 0, rest_cantitate: 100, rest_valoare: 1000, pct_decontat: 0, nedecontat: true, situatii: 0, ultima_situatie: null }),
  A('0002|D2|C4', { baza_valoare: 2000, decontat_valoare: 300, rest_valoare: 1700, pct_decontat: 15 }),
  // articol nou, în afara ofertei (cheie NULL, bază 0, peste ofertă)
  { ...A('0002|D2|NOU'), rand_id: '1:articol_nou:abc', cheie: null, tip_rand: 'articol_nou', baza_cantitate: 0, baza_valoare: 0, decontat_cantitate: 5, decontat_valoare: 80,
    rest_cantitate: -5, rest_valoare: -80, pct_decontat: null, peste_oferta: true },
]
// GROUPING SETS: obiect + proiect — sumele calculate de mână din ARTICOLE
export const OBIECTE = [
  { proiect_id: 1, nivel: 'obiect', obiect_cod: '0001', obiect_nume: 'OB 0001', baza_valoare: 2000, decontat_valoare: 1700, rest_valoare: 300, pct_decontat: 85, articole: 2, articole_nedecontate: 0, articole_peste: 1, articole_noi: 0 },
  { proiect_id: 1, nivel: 'obiect', obiect_cod: '0002', obiect_nume: 'OB 0002', baza_valoare: 3000, decontat_valoare: 380, rest_valoare: 2620, pct_decontat: 12.7, articole: 2, articole_nedecontate: 1, articole_peste: 1, articole_noi: 1 },
  { proiect_id: 1, nivel: 'proiect', obiect_cod: null, obiect_nume: null, baza_valoare: 5000, decontat_valoare: 2080, rest_valoare: 2920, pct_decontat: 41.6, articole: 4, articole_nedecontate: 1, articole_peste: 2, articole_noi: 1 },
]

// ── (2) clientul Supabase fals ──
export const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const cmpVal = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? '')))
/**
 * clientFals({ tabele, erori, rpc, plafon }) → { client, st }
 *  tabele: { nume: [rânduri] } (vederi și tabele; citite la fiecare cerere, deci un RPC fals poate „scrie” în ele); erori: { nume: { message } };
 *  rpc: (fn, args, st) => rezultat | Promise (implicit { data: null, error: null }); plafon: max-rows al serverului (răspunsul se taie la atâtea
 *  rânduri, oricât cere clientul — ca PostgREST). select(col, { count: 'exact' }) întoarce și `count` (rândurile după filtre, înainte de pagină).
 *  st.cereri = citirile (tabel + filtre), st.rpc = apelurile RPC, st.storage = orice atingere a Storage-ului (care și aruncă).
 *  ascunse: { nume: rând => true } — RLS simulat (r3): rândurile există (un RPC fals le scrie / le găsește), dar citirea clientului nu le vede.
 */
export function clientFals({ tabele = {}, erori = {}, rpc = null, plafon = null, ascunse = {} } = {}) {
  const st = { cereri: [], rpc: [], storage: [] }
  const client = {
    from: tabel => {
      const f = { eq: [], gt: null, ord: [], lim: null, range: null, unul: false, count: false }
      const q = {
        select: (c, opt) => { if (opt?.count === 'exact') f.count = true; return q }, in: () => q, is: () => q, not: () => q,
        eq: (c, v) => { f.eq.push([c, v]); return q }, gt: (c, v) => { f.gt = [c, v]; return q },
        order: c => { f.ord.push(c); return q }, limit: n => { f.lim = n; return q }, range: (a, b) => { f.range = [a, b]; return q },
        maybeSingle: () => { f.unul = true; return q }, single: () => { f.unul = true; return q },
        then: (res, rej) => {
          st.cereri.push({ tabel, ...f })
          if (erori[tabel]) return Promise.resolve({ data: null, error: erori[tabel] }).then(res, rej)
          // `col->>cheie` (calea JSON a PostgREST) se citește din obiectul coloanei
          const val = (x, c) => { const m = /^(\w+)->>(\w+)$/.exec(c); return m ? x[m[1]]?.[m[2]] : x[c] }
          let r = (tabele[tabel] || []).filter(x => !ascunse[tabel]?.(x)).filter(x => f.eq.every(([c, v]) => String(val(x, c)) === String(v)))
          if (f.gt) r = r.filter(x => cmpVal(x[f.gt[0]], f.gt[1]) > 0)
          if (f.ord.length) r = [...r].sort((a, b) => { for (const c of f.ord) { const d = cmpVal(a[c], b[c]); if (d) return d } return 0 })
          const count = r.length
          if (f.range) r = r.slice(f.range[0], f.range[1] + 1)
          if (f.lim != null) r = r.slice(0, f.lim)
          if (plafon != null) r = r.slice(0, plafon)
          r = r.map(x => ({ ...x }))
          return Promise.resolve({ data: f.unul ? r[0] || null : r, error: null, ...(f.count ? { count } : {}) }).then(res, rej)
        },
      }
      return q
    },
    rpc: async (fn, args) => {
      st.rpc.push({ fn, args })
      if (rpc) return rpc(fn, args, st)
      return { data: null, error: null }
    },
    // r2: ecranul NU urcă fișiere (documentul nu se păstrează deocamdată) → orice atingere a Storage-ului e o regresie
    storage: { from: bucket => { st.storage.push(bucket); throw new Error(`Storage atins (${bucket}): ecranul nu trebuie să urce fișiere`) } },
  }
  return { client, st }
}

// ── (3) montarea în jsdom ──
let curata = []
export function curataTot() { curata.reverse().forEach(f => f()); curata = [] }
export async function monteaza(element) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  // parsarea .docx (JSZip) și SHA-256 (Web Crypto) sunt asincrone reale: așteptarea face mai multe ture de microtask-uri + macrotask-uri
  const asteapta = async (ture = 6) => { for (let t = 0; t < ture; t++) await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }) }
  await act(async () => { root.render(element) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = text => { const b = butoane().filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const bifa = async el => { await act(async () => { el.click() }); await asteapta() }
  const camp = eticheta => d.querySelector(`[aria-label="${eticheta}"]`)
  /** alege un fișier în <input type=file> (jsdom nu are FileList construibil: proprietatea `files` se definește pe element) */
  const alegeFisier = async (el, fis) => {
    Object.defineProperty(el, 'files', { value: [fis], configurable: true })
    await act(async () => { el.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta(12)
  }
  /** așteaptă până când condiția e adevărată (operațiile asincrone reale: JSZip, Web Crypto); altfel eroare cu textul paginii */
  const pana = async (cond, ture = 60) => { for (let t = 0; t < ture; t++) { if (cond()) return; await asteapta(1) } throw new Error('condiția nu s-a îndeplinit; pagina: ' + d.body.textContent.slice(0, 600)) }
  /** aceeași rădăcină, alt element (ex. alt proiectId): React păstrează starea componentei, ca la navigarea reală */
  const rerandeaza = async el => { await act(async () => { root.render(el) }); await asteapta() }
  /** demontarea de dinaintea curățeniei (testele L24: răspuns sosit după închidere) */
  const demonteaza = async () => { await act(async () => { root.unmount() }) }
  return { d, j, act, buton, butoane, apasa, scrie, bifa, camp, alegeFisier, asteapta, pana, rerandeaza, demonteaza, text: () => d.body.textContent }
}
