// Harness-ul comun al testelor de ecran „🔔 Semnale” (ExecutieSemnale.test.jsx + ExecutieSemnaleMutanti.test.jsx): clientul Supabase FALS (vederea
// pe pagini keyset, angajații, jurnalul, RPC-ul eliberat manual, în modurile ok / auto / conflict / refuz / retea / 5xx / arunca) și montarea
// componentei REALE (sau a unei copii mutate) cu react-dom în jsdom. Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la ContractProiectTab.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suitele de
// ecran sunt SĂRITE VIZIBIL (JSDOM = null).
import React from 'react'
import { createRequire } from 'node:module'
import path from 'node:path'

export let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
export const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'

export const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
export const AZI = '2026-11-21'
export const SEM = (id, extra = {}) => ({
  id, proiect_id: 1, proiect_cod: 'P1', proiect_nume: 'Proiect unu', flux: 'lipsuri', tip: 'termen_apropiat', obiect: 'contract:termen', gravitate: 'atentie',
  titlu: `Semnal ${id}`, detalii: 'detalii ' + id, constatare: 'constatat', surse_consultate: [], dovada_sursa: 'camp_erp', dovada_data: '2026-11-21',
  dovada_fragment: 'data_termen = 2026-12-11', dovada_ref: 'executie_proiecte.data_termen', dovada_amprenta: '0'.repeat(32), termen: '2026-12-11', termen_baza: 'câmpul data_termen',
  termen_confirmat: true, incertitudine: null, propunere: 'Verificați AA.', responsabil_employee_id: null, responsabil_sursa: null, stare: 'nou', stare_motiv: null,
  stare_dovada: null, actiune_ref: null, stare_de: null, stare_la: null, regula_versiune: 'lipsuri-v1', detectat_la: '2026-11-21T20:00:00+00:00',
  ultima_verificare: '2026-11-21T20:00:00+00:00', versiune: 1, ...extra,
})
export const ANG = [{ id: 10, name: 'POPESCU ION', active: true }, { id: 11, name: 'IONESCU ANA', active: true }, { id: 15, name: 'PLECAT X', active: false }]

// clientul fals: vederea (pagini keyset pe id), angajații, jurnalul; RPC-ul se eliberează manual
export function clientFals({ randuri = [], jurnal = {}, erori = {} } = {}) {
  const server = new Map(randuri.map(r => [r.id, { ...r }]))
  const st = { poarta: null, rpc: [], cereri: [] }
  const client = {
    from: tabel => {
      const f = { eq: {}, in: null, gt: null, lim: 1000 }
      const q = {
        select: () => q, order: () => q, limit: n => { f.lim = n; return q },
        eq: (c, v) => { f.eq[c] = v; return q }, in: (_c, v) => { f.in = v; return q }, gt: (_c, v) => { f.gt = v; return q },
        then: (res, rej) => {
          st.cereri.push({ tabel, ...f })
          if (erori[tabel]) return Promise.resolve({ data: null, error: erori[tabel] }).then(res, rej)
          let rows
          if (tabel === 'v_executie_semnale') rows = [...server.values()].filter(r => (f.eq.proiect_id == null || r.proiect_id === f.eq.proiect_id) && (f.gt == null || r.id > f.gt)).sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
          else if (tabel === 'employees') rows = (f.in ? ANG.filter(a => f.in.includes(a.id)) : ANG).filter(a => f.gt == null || a.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim).map(a => ({ ...a }))
          else if (tabel === 'executie_semnale_jurnal') rows = (jurnal[f.eq.semnal_id] || []).filter(j => f.gt == null || j.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim)
          else rows = []
          const poarta = tabel === 'v_executie_semnale' && f.gt == null ? st.poarta : null
          return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: rows, error: null })).then(res, rej)
        },
      }
      return q
    },
    // moduri: 'ok' / 'auto' (serverul aplică); 'conflict'; 'refuz' (4xx: nimic scris); 'retea' / '5xx' (serverul A COMIS, răspunsul s-a pierdut:
    // postgrest-js dă status 0 la „Failed to fetch”); 'arunca' (serverul A COMIS, clientul aruncă o excepție — fetch-ul picat după trimitere)
    rpc: (fn, a) => {
      const d = amana(); st.rpc.push({ fn, a, ...d })
      return d.p.then(mod => {
        if (mod === 'refuz') return { data: null, error: { code: '42501', message: 'semnale: semnalul nu există sau nu ai drept asupra lui' }, status: 403 }
        const r = server.get(a.p_id)
        if (mod === 'conflict' || r.versiune !== a.p_versiune) return { data: { ok: false, motiv: 'conflict', semnal: { ...r } }, error: null, status: 200 }
        Object.assign(r, { stare: a.p_stare || r.stare, stare_motiv: a.p_motiv, stare_dovada: a.p_dovada, actiune_ref: a.p_actiune_ref, versiune: r.versiune + 1,
          stare_de: 'u1', stare_la: '2026-11-22T08:00:00+00:00',
          ...(a.p_schimba_responsabil ? { responsabil_employee_id: a.p_responsabil, responsabil_sursa: 'om' } : {}) })   // ca serverul: orice alegere a omului = sursa om
        if (mod === 'retea') return { data: null, error: { message: 'TypeError: Failed to fetch' }, status: 0 }
        if (mod === '5xx') return { data: null, error: { message: 'gateway timeout' }, status: 504 }
        if (mod === 'arunca') throw new TypeError('Failed to fetch')
        return { data: { ok: true, semnal: { ...r } }, error: null, status: 200 }
      })
    },
  }
  return { client, st, server }
}

let curata = []
/** de chemat din afterEach: demontează ecranele montate (în ordine INVERSĂ montării, ca fiecare să se demonteze sub window-ul lui) și pune la loc
 *  window / document */
export function curataTot() { curata.reverse().forEach(f => f()); curata = [] }

/**
 * Montează componenta dată (reală sau mutată): { ExecutieSemnale, SemnaleOwnerPanel } = exporturile modulului; props.owner = true montează panoul
 * owner-ului. Întoarce uneltele de interacțiune (butoane, câmpuri, eliberarea răspunsurilor amânate).
 */
export async function monteaza({ ExecutieSemnale, SemnaleOwnerPanel }, client, props = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  const randeaza = async p => { await act(async () => { root.render(props.owner ? <SemnaleOwnerPanel client={client} /> : <ExecutieSemnale proiectId={1} client={client} azi={AZI} {...p} />) }); await asteapta() }
  await randeaza(props)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = text => { const b = [...d.querySelectorAll('button')].filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const bifa = async el => { await act(async () => { el.click() }); await asteapta() }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  const camp = eticheta => d.querySelector(`[aria-label="${eticheta}"]`)
  const semnale = () => [...d.querySelectorAll('[data-semnal]')].map(x => Number(x.getAttribute('data-semnal')))
  return { d, buton, apasa, scrie, bifa, elibereaza, randeaza, camp, semnale, asteapta }
}
