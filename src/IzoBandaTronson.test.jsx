// Teste de componentă pentru IzoBandaTronson (banda conductei, doar citire): componenta reală montată cu react-dom în jsdom,
// cu un client Supabase FALS (tabele în memorie, doar citiri). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la src/ProbeTronsoane.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const st = vi.hoisted(() => ({ tabele: {}, cereri: [], poarta: null }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from: tabel => {
      const f = { eq: [], in: null, gt: null, lim: 1000 }
      const q = {
        select: () => q, order: () => q,
        eq: (c, v) => { f.eq.push([c, v]); return q },
        in: (c, v) => { f.in = [c, v]; return q },
        gt: (_c, v) => { f.gt = v; return q },
        limit: n => { f.lim = n; return q },
        then: (res, rej) => {
          st.cereri.push(tabel)
          const rows = (st.tabele[tabel] || []).filter(r => f.eq.every(([c, v]) => r[c] === v) && (!f.in || f.in[1].includes(r[f.in[0]])) && (f.gt == null || r.id > f.gt))
            .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
          // poarta: răspunsurile din executie_tevi așteaptă până le eliberează testul
          const p = tabel === 'executie_tevi' && st.poarta ? st.poarta.p : Promise.resolve()
          return p.then(() => ({ data: rows, error: null })).then(res, rej)
        },
      }
      return q
    },
    rpc: () => { throw new Error('ecranul de bandă nu are voie să apeleze RPC-uri') },
  },
}))
import IzoBandaTronson from './IzoBandaTronson.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[IzoBandaTronson.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

// date sintetice: un pachet care începe la km 1+010 cu o țeavă de 10 m și una de 12 m (serii inventate)
const PACHET = { id: 7, proiect_id: 1, tronson_id: 50, cod_document_full: 'DOC-A', revizie: 0, status: 'draft', km_start_m: '1010.00', updated_at: null }
const TEVI = [
  { id: 2, pachet_id: 7, poz_in_pachet: 1, tip_rand: 'teava', serie_unica: 'SX001', tip: 'L360', lungime_m: '10.000', sudura_cod: 'T1S1', sudura_refacuta: false, sudura_sant_pending: false },
  { id: 3, pachet_id: 7, poz_in_pachet: 2, tip_rand: 'teava', serie_unica: 'SX002', tip: 'L360', lungime_m: '12.000', sudura_cod: 'T1S2', sudura_refacuta: false, sudura_sant_pending: false },
]
const CU_LIMITE = { id: 50, proiect_id: 1, cod: 'T1', km_start_m: 1000, km_end_m: 1030 }
const FARA_LIMITE = { id: 50, proiect_id: 1, cod: 'T1', km_start_m: null, km_end_m: null }

const curata = []
afterEach(() => { while (curata.length) curata.pop()() })

async function monteaza(tronson, { poarta = null } = {}) {
  st.tabele = { executie_pachete_lansare: [PACHET], executie_tevi: TEVI }
  st.cereri = []
  st.poarta = poarta
  const j = new JSDOM('<!doctype html><div id="r"></div>')
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(j.window.document.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<IzoBandaTronson proiectId={1} tronsoane={[tronson]} initialTronsonId={50} />) })
  await asteapta()
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => { demonteaza(); Object.assign(globalThis, vechi); st.poarta = null })
  const q = sel => j.window.document.querySelector(`[data-test="${sel}"]`)
  const text = () => j.window.document.body.textContent
  const bifeaza = async el => { await act(async () => { el.click() }); await asteapta() }
  return { q, text, bifeaza, demonteaza, asteapta }
}

dom(numeDom('IzoBandaTronson — convenția și numitorul'), () => {
  it('convenția folosită e B și e scrisă pe ecran; comparația cu A nu e preselectată', async () => {
    const e = await monteaza(CU_LIMITE)
    expect(e.q('conventie').textContent).toContain('B · km start pachet = prima sudură')
    expect(e.q('compara-a').checked).toBe(false)
    expect(e.q('comparatie-a')).toBe(null)
    // B: sudura primei țevi = 1+010 → țevile pe [1000, 1010) și [1010, 1022): 22 m în pachete, 8 m necunoscut
    expect(e.q('kpi-realizat').textContent).toContain('22,00 m')
    expect(e.q('kpi-realizat').textContent).toContain('din 30,00 m ai tronsonului')
    expect(e.q('kpi-necunoscut').textContent).toContain('8,00 m')
    expect(st.cereri).toEqual(['executie_pachete_lansare', 'executie_tevi', 'executie_tevi'])
  })
  it('comparația cu A apare doar la cerere, etichetată, cu diferențele față de B', async () => {
    const e = await monteaza(CU_LIMITE)
    await e.bifeaza(e.q('compara-a'))
    const c = e.q('comparatie-a')
    expect(c.textContent).toContain('Comparație, nu rezultat')
    // A: prima țeavă începe la 1+010 → [1010, 1020) și [1020, 1032): 20 m în limite (2 m în afară), 10 m necunoscut
    const rand = t => [...c.querySelectorAll('tr')].find(tr => tr.textContent.startsWith(t)).textContent
    expect(rand('În pachete')).toBe('În pachete (reuniune)22,00 m20,00 m-2,00 m')
    expect(rand('Necunoscut')).toBe('Necunoscut pe tronson8,00 m10,00 m+2,00 m')
    expect(rand('În afara')).toBe('În afara limitelor0,00 m2,00 m+2,00 m')
    // banda și KPI-urile rămân pe B
    expect(e.q('kpi-realizat').textContent).toContain('22,00 m')
  })
  it('tronson fără limite: nu scrie „din X m ai tronsonului”, necunoscutul pe tronson nu e 0', async () => {
    const e = await monteaza(FARA_LIMITE)
    expect(e.q('kpi-realizat').textContent).not.toContain('ai tronsonului')
    expect(e.q('kpi-realizat').textContent).toContain('lungimea tronsonului: necunoscută')
    expect(e.q('kpi-realizat').textContent).toContain('întinderea datelor: 22,00 m')
    // valoarea = „necunoscut” (nu 0); golurile din întinderea datelor sunt separat, în subtitlu
    expect(e.q('kpi-necunoscut').textContent).toBe('Necunoscutnecunoscutpe tronson nu se poate calcula; goluri în întinderea datelor: 0,00 m')
    expect(e.text()).toContain('Toată întinderea datelor')
  })
  it('ecran închis în timpul citirii: paginarea se oprește (nicio pagină nouă după demontare)', async () => {
    let elibereaza
    const poarta = { p: new Promise(r => { elibereaza = r }) }
    const e = await monteaza(CU_LIMITE, { poarta })
    expect(st.cereri).toEqual(['executie_pachete_lansare', 'executie_tevi']) // prima pagină, în așteptare
    e.demonteaza()
    elibereaza()
    await e.asteapta()
    expect(st.cereri).toEqual(['executie_pachete_lansare', 'executie_tevi'])  // pe codul vechi: a doua pagină se cerea oricum
  })
  it('data situației pachetului: afișată ca necunoscută', async () => {
    const e = await monteaza(CU_LIMITE)
    expect(e.text()).toContain('situație: necunoscută')
  })
})
