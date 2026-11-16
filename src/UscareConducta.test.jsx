// Teste de componentă pentru UscareConducta: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS (CAS pe versiune și
// cheia apăsării ca serverul) ale cărui răspunsuri RPC se pot elibera manual. Fără rețea, fără librării noi. Date SINTETICE.
// jsdom nu e dependență a proiectului (ca la src/FibraOptica.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e
// SĂRITĂ VIZIBIL.
// Ce probează (constatările review-ului #1112): creare cu rezultat necunoscut -> nicio creare nouă până la lămurire, retrimiterea cu ACEEAȘI
// cheie, un singur raport (P1); conflict de versiune -> formularul NU salvează peste coleg, îmbinare pe câmpuri, versiunea de bază (P1);
// ciorna pentru raportul nou, înaintea primei salvări, și eroarea de stocare arătată (P2).
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import UscareConducta from './UscareConducta.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[UscareConducta.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const RAP = (id, extra = {}) => ({
  id, proiect_id: 1, proba_id: null, tronson: 'Tr. test', km_de_la_m: 0, km_pana_la_m: 1000, lungime_m: 1000, inceput_planificat: null, notificare_la: null,
  notificare_ref: null, data_operatie: null, ora_inceput: null, ora_final: null, poz_lat: null, poz_lng: null, poz_sursa: null, poz_precizie_m: null, poz_la: null,
  poz_km_m: null, poz_traseu_versiune: null, temperatura_c: null, temperatura_sursa: null, meteo: null, vreme: null, constructor: 'Constructor SRL', utilaje: [],
  pig_metalic_buc: null, piston_pu_buc: null, bureti_buc: null, cantariri: [], punct_roua_c: null, punct_roua_loc: null, presiune_bar: null,
  timp_deplasare_min: null, piston_final_rezultat: null, poze_justificare: null, observatii: null, concluzie: null, semn_constructor_nume: null,
  semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null, stare: 'deschisa', motiv_anulare: null, revizie: 0,
  inchis_la: null, versiune: 1, creat_la: '2026-11-10T08:00:00Z', modificat_la: '2026-11-10T08:00:00Z', ...extra,
})
const stocareFalsa = ({ stricata = false } = {}) => {
  const m = new Map(), s = { m }
  Object.assign(s, { key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => { m.delete(k) },
    setItem: (k, v) => { if (stricata && k.includes('ciorna')) throw new Error('QuotaExceededError'); m.set(k, String(v)) } })
  Object.defineProperty(s, 'length', { get: () => m.size })
  return s
}
function clientFals({ rapoarte = [] } = {}) {
  const T = { executie_uscari: new Map(rapoarte.map(r => [r.id, { ...r }])), executie_uscare_jurnal: new Map() }
  const st = { rpc: [], auto: true }
  let idNou = 100
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q, in: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        const date = [...(T[tabel] || new Map()).values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        return Promise.resolve({ data: date, error: null }).then(res, rej)
      },
    }
    return q
  }
  // serverul FALS: cheia apăsării (duplicat), CAS pe versiune (conflict cu rândul curent), creare
  const aplica = (fn, a) => {
    const j = [...T.executie_uscare_jurnal.values()].find(x => x.cheie === a.p_cheie)
    if (j) return { ok: true, duplicat: true, uscare: { ...T.executie_uscari.get(j.uscare_id) } }
    if (fn !== 'fn_executie_uscare_salveaza') throw new Error('rpc necunoscut ' + fn)
    if (a.p_id == null) {
      const r = RAP(++idNou, { ...a.p_date, versiune: 1 })
      T.executie_uscari.set(r.id, r)
      T.executie_uscare_jurnal.set(++idNou, { cheie: a.p_cheie, uscare_id: r.id })
      return { ok: true, duplicat: false, uscare: { ...r } }
    }
    const r = T.executie_uscari.get(a.p_id)
    if (r.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', uscare: { ...r } }
    Object.assign(r, a.p_date, { versiune: r.versiune + 1 })
    T.executie_uscare_jurnal.set(++idNou, { cheie: a.p_cheie, uscare_id: r.id })
    return { ok: true, duplicat: false, uscare: { ...r } }
  }
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    from: tabel => interogare(tabel),
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: true, error: null })
      if (fn === 'fn_executie_contract_drept') return Promise.resolve({ data: false, error: null })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      // st.devreme: serverul scrie LA APEL, dar răspunsul se pierde (timeout) la eliberarea cu „eroare”
      const devreme = st.devreme ? aplica(fn, a) : null
      if (st.auto) d.res('ok')
      return d.p.then(mod => (mod === 'eroare' ? { data: null, error: { message: 'timeout simulat' } } : { data: devreme || aplica(fn, a), error: null }))
    },
  }
  return { client, st, T }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client, stocare = stocareFalsa()) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  j.window.confirm = () => true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<UscareConducta proiectId={1} client={client} stocare={stocare} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = text => { const b = butoane().filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const camp = eticheta => { const l = [...d.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent.startsWith(eticheta)); if (!l) throw new Error('nu găsesc câmpul ' + eticheta); return l.querySelector('input, textarea') }
  const scrie = async (eticheta, val) => {
    const el = camp(eticheta)
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const bifeaza = async text => {
    const l = [...d.querySelectorAll('label')].find(x => x.textContent.includes(text))
    await act(async () => { l.querySelector('input').click() }); await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  return { d, apasa, buton, butoane, scrie, camp, bifeaza, elibereaza, asteapta, text: () => d.body.textContent }
}

dom(numeDom('UscareConducta (jsdom + react-dom)'), () => {
  it('P1 creare: timeout după scriere -> nicio creare nouă până la lămurire; retrimiterea folosește ACEEAȘI cheie; un singur raport', async () => {
    const { client, st, T } = clientFals()
    st.auto = false; st.devreme = true
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('Alt interval / tot traseul'))
    await u.scrie('Tronson (cum apare în raport)', 'Tr. 9')
    await u.scrie('De la km', '0+000')
    await u.scrie('La km', '1+000')
    expect(u.buton('Creează raportul').disabled).toBe(true)          // constructorul se confirmă întâi
    await u.bifeaza('Confirm constructorul')
    await u.apasa(u.buton('Creează raportul'))
    expect(st.rpc).toHaveLength(1)
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(T.executie_uscari.size).toBe(1)                            // serverul a scris
    expect(u.text()).toContain('rezultat necunoscut')
    expect(u.buton('Lămurește cererea de sus').disabled).toBe(true)   // nu se emite altă creare
    await u.apasa(u.buton('← Lista'))
    expect(u.text()).toContain('Ai o creare de raport nelămurită')
    expect(() => u.buton('Alt interval / tot traseul')).toThrow()
    st.auto = true
    await u.apasa(u.buton('Retrimite identic'))
    expect(st.rpc).toHaveLength(2)
    expect(st.rpc[1].a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    expect(T.executie_uscari.size).toBe(1)
    expect(u.text()).toContain('se salvase deja')
    expect([...stocare.m.keys()].filter(k => k.includes('incert'))).toHaveLength(0)
  })

  it('P1 conflict: colegul a salvat între timp -> NU se salvează peste el; îmbinare pe câmpuri; salvarea pe versiunea nouă', async () => {
    const { client, st, T } = clientFals({ rapoarte: [RAP(1, { presiune_bar: 1.5, versiune: 1 })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    // colegul (alt telefon) salvează presiunea între timp
    Object.assign(T.executie_uscari.get(1), { presiune_bar: 2, versiune: 2 })
    await u.scrie('Observații', 'scris pe telefonul B')
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].a.p_versiune).toBe(1)
    expect(T.executie_uscari.get(1)).toMatchObject({ presiune_bar: 2, observatii: null, versiune: 2 })   // nimic scris peste coleg
    expect(u.text()).toContain('NU am salvat peste el')
    expect(u.buton('Rezolvă conflictul de sus').disabled).toBe(true)
    expect(u.camp('Presiunea în spatele buretelui (bar)').value).toBe('2')                          // modificarea colegului, pe formular
    await u.apasa(u.buton('Am ales'))
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc).toHaveLength(2)
    expect(st.rpc[1].a.p_versiune).toBe(2)
    expect(T.executie_uscari.get(1)).toMatchObject({ presiune_bar: 2, observatii: 'scris pe telefonul B', versiune: 3 })
  })

  it('P1 conflict pe ACELAȘI câmp: alegerea e explicită (fără alegere nu se poate continua)', async () => {
    const { client, st, T } = clientFals({ rapoarte: [RAP(1, { presiune_bar: 1.5, versiune: 1 })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    Object.assign(T.executie_uscari.get(1), { presiune_bar: 2, versiune: 2 })
    await u.scrie('Presiunea în spatele buretelui (bar)', '1,8')
    await u.apasa(u.buton('💾 Salvează'))
    expect(u.buton('Am ales').disabled).toBe(true)
    await u.apasa(u.buton('Al meu: 1,8'))
    await u.apasa(u.buton('Am ales'))
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 2, p_date: { presiune_bar: 1.8 } })
  })

  it('P2 ciorna pentru raportul NOU (înainte de prima salvare) se oferă la redeschidere; eroarea de stocare se arată', async () => {
    const { client } = clientFals()
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('Alt interval / tot traseul'))
    await u.scrie('Tronson (cum apare în raport)', 'Tr. ciornă')
    expect([...stocare.m.keys()].some(k => k.endsWith(':1:nou'))).toBe(true)
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Alt interval / tot traseul'))
    expect(u.text()).toContain('Ai modificări nesalvate')
    await u.apasa(u.buton('Restaurez'))
    expect(u.camp('Tronson (cum apare în raport)').value).toBe('Tr. ciornă')

    const u2 = await monteaza(clientFals().client, stocareFalsa({ stricata: true }))
    await u2.apasa(u2.buton('Alt interval / tot traseul'))
    await u2.scrie('Tronson (cum apare în raport)', 'x')
    expect(u2.text()).toContain('Ciorna locală nu se poate scrie')
  })
})
