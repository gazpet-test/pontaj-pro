// TKT-2026-0329 A, PR-UI (review Jakarinos r2 P2): cardul semnalelor DEJA DESCHIS se recitește după o extragere încheiată în „🧪 Probă extractor”
// din același ecran (serverul publică o evaluare nouă la finalul rulării). Ambele carduri reale, montate împreună ca în fișa licitației
// (părintele leagă onRulare → reloadKey), client Supabase FALS: lista semnalelor se schimbă DUPĂ apelul edge-ului. jsdom nu e dependență a
// proiectului: fără el suita e SĂRITĂ VIZIBIL.
import React, { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// amana[tabel] = valoare => Promise<{data, error}>: selectul rămâne în zbor până îl rezolvă testul (review r3 P2)
const st = vi.hoisted(() => ({ rpc: {}, tabele: {}, cereri: [], invocari: 0, listaCurenta: () => [], amana: {} }))
vi.mock('./lib/supabase.js', () => ({ supabase: clientFals(st) }))
import OfertareSemnale from './OfertareSemnale.jsx'
import OfertareProbaExtractor from './OfertareProbaExtractor.jsx'

function clientFals(s) {
  const rpc = (fn, args, range) => {
    s.cereri.push({ rpc: fn, args, range })
    const r = s.rpc[fn]
    return Promise.resolve(typeof r === 'function' ? r(args, range) : (r ?? { data: null, error: { message: `rpc necunoscut ${fn}` } }))
  }
  return {
    rpc: (fn, args) => ({ then: (ok, ko) => rpc(fn, args, null).then(ok, ko), range: (a, b) => ({ then: (ok, ko) => rpc(fn, args, [a, b]).then(ok, ko) }) }),
    functions: { invoke: async (fn, o) => { s.invocari++; s.cereri.push({ invoke: fn, body: o?.body })
      // edge-ul fals: rularea se încheie într-un pas; de aici încolo serverul „a publicat” evaluarea nouă
      s.listaCurenta = () => RANDURI_V2
      return { data: { oprit: null, felii_apelate: 1, cost_usd: 0.01, raport: [], masuratori: { ok: true, rezumat: { diferente: 1, de_verificat: 0, neverificate: 0, in_regula: 0, altele: 0, total: 1 } } }, error: null } } },
    from: tabel => {
      const q = { tabel, filtre: [], unic: false }
      for (const m of ['select', 'order', 'limit']) q[m] = () => q
      q.eq = (c, v) => { q.filtre.push([c, v]); return q }
      q.maybeSingle = () => { q.unic = true; return q }
      q.then = (ok, ko) => {
        s.cereri.push({ tabel, filtre: q.filtre })
        const rows = (s.tabele[tabel] || []).filter(r => q.filtre.every(([c, v]) => r[c] === v))
        if (s.amana?.[tabel]) return s.amana[tabel](q.unic ? (rows[0] ?? null) : rows).then(ok, ko)
        return Promise.resolve({ data: q.unic ? (rows[0] ?? null) : rows, error: null }).then(ok, ko)
      }
      return q
    },
  }
}

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const x of surse) { try { JSDOM = createRequire(x)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[OfertareSemnale.rulare.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

const LIC = { id: 900001, nr_anunt: 'CN-TEST', obiect: 'Obiect de test', stare_loturi: 'fara_loturi' }
const semnal = (id, verdict, extra = {}) => ({ id, licitatie_id: LIC.id, lot_nr: null, obiect_cheie: '*', element: 'teava_pe_dn160', clasa: 'fizica', um_canonica: 'm',
  identitate: '0123456789abcdef', verdict, motiv: null, valoare_a: 6400, valoare_b: 6400, valori_b: [], inventar: {}, clarificare_id: null, reaparut_dupa_respingere: false, rezolvare: null, ...extra })
// evaluarea veche: în regulă; evaluarea nouă (după extragere): diferență
const RANDURI_V1 = [{ semnal: semnal(1, 'in_regula'), rezolvat: false, actual: true, in_curs: false, masuratori: [] }]
const RANDURI_V2 = [{ semnal: semnal(1, 'diferenta', { motiv: 'A 6.400 m, B 3.995 m (37,6 % > 5 %)', valoare_b: 3995 }), rezolvat: false, actual: true, in_curs: false, masuratori: [] }]

// părintele = legătura din fișa licitației (OfertareLicitatii.jsx): onRulare → reloadKey
function Fisa() {
  const [k, setK] = useState(0)
  return <>
    <OfertareProbaExtractor licitatie={LIC} onRulare={() => setK(x => x + 1)} />
    <OfertareSemnale licitatie={LIC} profile={{ id: 'u1' }} showToast={() => {}} deschisInitial reloadKey={k} />
  </>
}

const LIC_B = { id: 900002, nr_anunt: 'CN-TEST-B', obiect: 'A doua licitație', stare_loturi: 'fara_loturi' }
// proba extractorului singură, cu licitația comutabilă din afară (ca schimbarea fișei) și onRulare numărat
let comuta = null
function ProbaSingura({ onRulare }) {
  const [lic, setLic] = useState(LIC)
  comuta = setLic
  return <OfertareProbaExtractor licitatie={lic} onRulare={onRulare} />
}
const TABELE_PROBA = () => ({
  ofertare_ai_buget: [{ licitatie_id: LIC.id, scop: 'cant_extragere', plafon_usd: 5, blocat: false }, { licitatie_id: LIC_B.id, scop: 'cant_extragere', plafon_usd: 5, blocat: false }],
  ofertare_ai_rezervari: [],
  ofertare_ai_cereri: [{ id: 7, licitatie_id: LIC.id, scop: 'cant_extragere', stare: 'activa', valabil_pana: new Date(Date.now() + 3600e3).toISOString(), lot_domeniu: 'toate', lot_nr: [] }],
})
async function monteazaProba(onRulare) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  j.window.confirm = () => true
  const { createRoot } = await import('react-dom/client')
  const act = React.act
  const root = createRoot(j.window.document.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 120; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<ProbaSingura onRulare={onRulare} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const d = j.window.document
  const header = [...d.querrySelectorAll?.('span') ?? d.querySelectorAll('span')].find(s => s.textContent.includes('Probă extractor cantități')).parentElement
  await act(async () => { header.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta()
  const apasa = async b => { await act(async () => { b.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const buton = txt => [...d.querySelectorAll('button')].find(b => b.textContent.includes(txt))
  return { d, act, asteapta, apasa, buton, text: () => d.body.textContent }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.rpc = {}; st.tabele = {}; st.cereri = []; st.invocari = 0; st.listaCurenta = () => []; st.amana = {}; vi.restoreAllMocks() })

dom('onRulare — contextul reverificat după recitirea bugetului; notificarea nu depinde de reușita recitirii (review r3 P2)', () => {
  it('extragerea pe A termină, recitirea bugetului e în zbor, omul trece pe B, recitirea se termină → onRulare NU e chemat', async () => {
    st.tabele = TABELE_PROBA()
    let n = 0, rezolva = null
    // prima citire a bugetului (la deschidere) trece; a doua (după rulare) rămâne în zbor
    st.amana.ofertare_ai_buget = valoare => { n++; return n <= 1 ? Promise.resolve({ data: valoare, error: null }) : new Promise(res => { rezolva = () => res({ data: valoare, error: null }) }) }
    const onRulare = vi.fn()
    const { act, asteapta, apasa, buton } = await monteazaProba(onRulare)
    await apasa(buton('Rulează B'))
    expect(st.invocari).toBe(1); expect(rezolva).toBeTypeOf('function'); expect(onRulare).not.toHaveBeenCalled()
    await act(async () => { comuta(LIC_B) }); await asteapta()
    await act(async () => { rezolva() }); await asteapta()
    expect(onRulare).not.toHaveBeenCalled()
  })
  it('recitirea bugetului RESPINSĂ după rulare → onRulare e chemat totuși (o dată, cu licitația rulării) și eroarea recitirii e afișată', async () => {
    st.tabele = TABELE_PROBA()
    let n = 0
    st.amana.ofertare_ai_buget = valoare => { n++; return n <= 1 ? Promise.resolve({ data: valoare, error: null }) : Promise.reject(new TypeError('Failed to fetch')) }
    const onRulare = vi.fn()
    const { apasa, buton, text } = await monteazaProba(onRulare)
    await apasa(buton('Rulează B'))
    expect(st.invocari).toBe(1)
    expect(onRulare).toHaveBeenCalledTimes(1); expect(onRulare).toHaveBeenCalledWith(LIC.id)
    expect(text()).toContain('Recitirea bugetului a eșuat')
  })
})

dom('cardul semnalelor se recitește după extragerea din același ecran (jsdom)', () => {
  it('ambele carduri deschise: după „Rulează B” evaluarea veche (în regulă) e înlocuită de cea nouă (diferență), fără închidere / redeschidere', async () => {
    st.listaCurenta = () => RANDURI_V1
    st.rpc = {
      fn_ofertare_semnale_lista: (args, range) => ({ data: range && range[0] === 0 ? st.listaCurenta() : [], error: null }),
      fn_ofertare_source_pack_poate_decide: { data: true, error: null },
    }
    st.tabele = {
      ofertare_documente_atribuire: [], ofertare_cantitati_setari: [], ofertare_cantitati_evaluari: [],
      ofertare_ai_buget: [{ licitatie_id: LIC.id, scop: 'cant_extragere', plafon_usd: 5, blocat: false }],
      ofertare_ai_rezervari: [],
      ofertare_ai_cereri: [{ id: 7, licitatie_id: LIC.id, scop: 'cant_extragere', stare: 'activa', valabil_pana: new Date(Date.now() + 3600e3).toISOString(), lot_domeniu: 'toate', lot_nr: [] }],
    }
    const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
    const vechi = { window: globalThis.window, document: globalThis.document }
    Object.assign(globalThis, { window: j.window, document: j.window.document })
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    j.window.confirm = () => true
    const { createRoot } = await import('react-dom/client')
    const act = React.act
    const root = createRoot(j.window.document.getElementById('r'))
    const asteapta = async () => { await act(async () => { for (let i = 0; i < 120; i++) await Promise.resolve() }) }
    await act(async () => { root.render(<Fisa />) })
    await asteapta()
    curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
    const d = j.window.document
    // cardul probei: deschide-l (header-ul) ca să apară butoanele; cardul semnalelor e deschis din start și arată evaluarea veche
    const verdict = () => d.querySelector('[data-verdict][data-semnal="1"]')
    expect(verdict().textContent).toBe('✓ în regulă')
    const header = [...d.querySelectorAll('span')].find(s => s.textContent.includes('Probă extractor cantități')).parentElement
    await act(async () => { header.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta()
    const ruleaza = [...d.querySelectorAll('button')].find(b => b.textContent.includes('Rulează B'))
    expect(ruleaza.disabled).toBe(false)
    const listariInainte = st.cereri.filter(c => c.rpc === 'fn_ofertare_semnale_lista').length
    await act(async () => { ruleaza.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta(); await asteapta()
    expect(st.invocari).toBe(1)
    // jurnalul probei are linia semnalelor, iar cardul semnalelor a recitit lista și arată evaluarea NOUĂ
    expect(d.body.textContent).toContain('📏 Semnale: 1 diferențe, 0 de verificat, 0 neverificate (0 în regulă, 1 în total)')
    expect(st.cereri.filter(c => c.rpc === 'fn_ofertare_semnale_lista').length).toBeGreaterThan(listariInainte)
    expect(verdict().textContent).toBe('⚠ diferență: A 6.400 m, B 3.995 m (37,6 % > 5 %)')
    expect(d.body.textContent).not.toContain('✓ în regulă')
  })
})
