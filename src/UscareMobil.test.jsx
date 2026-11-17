// Teste de componentă: lansatorul de telefon (/m, AppMobilManageri REAL) cu butonul „Uscare conductă” și ecranul de uscare REAL
// (UscareConducta), montate cu react-dom în jsdom, pe un client Supabase FALS. Fără rețea, fără librării noi. Date SINTETICE.
// jsdom nu e dependență a proiectului (ca la src/UscareConducta.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el,
// suita e SĂRITĂ VIZIBIL.
// Ce probează: butonul apare / nu apare după dreptul dat de server (fn_executie_nod_drept(proiect, true)); un proiect -> direct ecranul de
// uscare; mai multe -> lista (cel cu uscare deschisă sus) și „Înapoi”; o verificare eșuată se arată și se reîncearcă (L18); schimbarea
// proiectului cât primul încă se încarcă nu amestecă datele (L24).
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// clientul fals se schimbă la fiecare test; modulul mock-uit expune un intermediar stabil
const fals = vi.hoisted(() => {
  const h = { cur: null }
  h.client = {
    auth: { getUser: (...a) => h.cur.auth.getUser(...a), getSession: (...a) => h.cur.auth.getSession(...a) },
    from: t => h.cur.from(t), rpc: (...a) => h.cur.rpc(...a), storage: { from: b => h.cur.storage.from(b) },
  }
  return h
})
vi.mock('./lib/supabase.js', () => ({ supabase: fals.client }))
// ce nu ține de uscare (vremea, PDF-ul raportului zilnic, rezumatul, probele) — înlocuit cu nimic
vi.mock('./Meteo.jsx', () => ({ MeteoBadge: () => null }))
vi.mock('./MeteoZiXweather.jsx', () => ({ default: () => null }))
vi.mock('./raportDistributiePdf.js', () => ({ exportRaportDistributiePDF: async () => {} }))
vi.mock('./RubricaRezumat.jsx', () => ({ default: () => null }))
vi.mock('./ProbeTerenMobil.jsx', () => ({ default: () => null }))
vi.mock('./uscarePdf.js', () => ({ exportRaportUscarePDF: async () => ({ necitite: 0 }) }))
import { MemoryRouter } from 'react-router-dom'
import AppMobilManageri from './AppMobilManageri.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[UscareMobil.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const PROIECT = (id, extra = {}) => ({ id, nume: `Proiect test ${id}`, cod_intern: `T${id}`, activ: true, ...extra })
// rândul complet, ca selectul ecranului de uscare (același tipar ca RAP din src/UscareConducta.test.jsx)
const USCARE = (id, proiect_id, extra = {}) => ({
  id, proiect_id, proba_id: null, tronson: `Tronson P${proiect_id}`, km_de_la_m: 0, km_pana_la_m: 100, lungime_m: 100, inceput_planificat: null, notificare_la: null,
  notificare_ref: null, data_operatie: '2026-11-10', ora_inceput: null, ora_final: null, poz_lat: null, poz_lng: null, poz_sursa: null, poz_precizie_m: null, poz_la: null,
  poz_km_m: null, poz_traseu_versiune: null, temperatura_c: null, temperatura_sursa: null, meteo: null, vreme: null, constructor: 'Constructor SRL', utilaje: [],
  pig_metalic_buc: null, piston_pu_buc: null, bureti_buc: null, cantariri: [], punct_roua_c: null, punct_roua_loc: null, presiune_bar: null,
  timp_deplasare_min: null, piston_final_rezultat: null, poze_justificare: null, observatii: null, concluzie: null, semn_constructor_nume: null,
  semn_constructor_functie: null, semn_beneficiar_nume: null, semn_beneficiar_functie: null, stare: 'deschisa', motiv_anulare: null, revizie: 0,
  inchis_la: null, versiune: 1, creat_la: '2026-11-10T08:00:00Z', modificat_la: '2026-11-10T08:00:00Z', ...extra,
})

// drept: Map proiect -> true | false | 'eroare'; amana(tabel, filtre) = true -> citirea așteaptă eliberarea manuală (st.cereri)
function clientFals({ proiecte = [], uscari = [], drept = new Map() } = {}) {
  const T = {
    profiles: [{ id: 'u1', name: 'TEST SANTIER', role: 'sef_santier', is_owner: false }],
    profile_sites: [], sites: [], executie_proiecte: proiecte, executie_uscari: uscari, executie_probe_tronsoane: [],
  }
  const st = { drept, amana: () => false, cereri: [], rpc: [] }
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000, unul: false }
    const calc = () => {
      const r = (T[tabel] || []).filter(x => f.eq.every(([c, v]) => x[c] === v) && (f.gt == null || x.id > f.gt)).sort((a, b) => (a.id > b.id ? 1 : -1)).slice(0, f.lim).map(x => ({ ...x }))
      return { data: f.unul ? r[0] || null : r, error: null }
    }
    const q = {
      select: () => q, order: () => q, in: () => q, lt: () => q, is: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q }, limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      maybeSingle: () => { f.unul = true; return q }, single: () => { f.unul = true; return q },
      then: (res, rej) => {
        if (st.amana(tabel, f)) { const d = amana(); st.cereri.push({ tabel, eq: f.eq, ...d }); return d.p.then(calc).then(res, rej) }
        return Promise.resolve(calc()).then(res, rej)
      },
    }
    return q
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }), getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    from: interogare,
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
    rpc: async (fn, a) => {
      st.rpc.push({ fn, a })
      if (fn === 'probe_teren_drept') return { data: false, error: null }
      if (fn === 'fn_executie_contract_drept') return { data: false, error: null }
      if (fn === 'fn_executie_nod_drept') {
        const v = st.drept.get(a.p_proiect)
        return v === 'eroare' ? { data: null, error: { message: 'Failed to fetch' } } : { data: v === true, error: null }
      }
      throw new Error('rpc neașteptat ' + fn)
    },
  }
  return { client, st, T }
}
const stocareFalsa = () => {
  const m = new Map(), s = { key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => { m.delete(k) }, setItem: (k, v) => { m.set(k, String(v)) } }
  Object.defineProperty(s, 'length', { get: () => m.size })
  return s
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(fc) {
  fals.cur = fc.client
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'localStorage', { value: stocareFalsa(), configurable: true, writable: true })
  j.window.confirm = () => true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<MemoryRouter><AppMobilManageri /></MemoryRouter>) })
  await asteapta()
  curata.push(() => {
    act(() => root.unmount())
    Object.assign(globalThis, { window: vechi.window, document: vechi.document })
    if (vechi.localStorage) Object.defineProperty(globalThis, 'localStorage', vechi.localStorage); else delete globalThis.localStorage
  })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = text => { const b = butoane().find(x => x.textContent.includes(text) || x.getAttribute('aria-label') === text); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const areButon = text => butoane().some(x => x.textContent.includes(text) || x.getAttribute('aria-label') === text)
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const elibereaza = async c => { await act(async () => { c.res() }); await asteapta() }
  return { d, apasa, buton, areButon, elibereaza, asteapta, text: () => d.body.textContent }
}

dom(numeDom('Uscare conductă în lansatorul /m (jsdom + react-dom)'), () => {
  it('fără drept de scriere pe niciun proiect -> butonul NU apare (dreptul îl dă serverul, pe fiecare proiect)', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1), PROIECT(2)], drept: new Map([[1, false], [2, false]]) })
    const u = await monteaza(fc)
    expect(u.text()).toContain('Raport')
    expect(u.areButon('Uscare')).toBe(false)
    // aceeași funcție ca ecranul de uscare, cu scriere
    expect(fc.st.rpc.filter(r => r.fn === 'fn_executie_nod_drept').map(r => [r.a.p_proiect, r.a.p_scriere]).sort()).toEqual([[1, true], [2, true]])
  })

  it('arhiva fără uscări deschise nu se verifică și nu se oferă', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1, { activ: false })], drept: new Map([[1, true]]) })
    const u = await monteaza(fc)
    expect(u.areButon('Uscare')).toBe(false)
    expect(fc.st.rpc.some(r => r.fn === 'fn_executie_nod_drept')).toBe(false)
  })

  it('un singur proiect activ cu drept -> butonul apare și duce DIRECT în ecranul de uscare; „Înapoi” = lansatorul', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1), PROIECT(2)], uscari: [USCARE(11, 2)], drept: new Map([[1, false], [2, true]]) })
    const u = await monteaza(fc)
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).not.toContain('Alege proiectul')
    expect(u.text()).toContain('T2 — Proiect test 2')
    expect(u.text()).toContain('Tronson P2')
    await u.apasa(u.buton('Înapoi'))
    expect(u.areButon('Uscare')).toBe(true)
    expect(u.text()).toContain('Raport')
  })

  it('mai multe proiecte -> lista (cel cu uscare deschisă sus), alegerea deschide ecranul, „Înapoi” = lista, apoi lansatorul', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1, { nume: 'Alfa' }), PROIECT(2, { nume: 'Beta' }), PROIECT(3, { nume: 'Gama', activ: false })],
      uscari: [USCARE(31, 3)], drept: new Map([[1, true], [2, true], [3, true]]) })
    const u = await monteaza(fc)
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).toContain('Alege proiectul')
    const lista = [...u.d.querySelectorAll('button')].map(b => b.textContent).filter(t => t.startsWith('T'))
    expect(lista.map(t => t.slice(0, 2))).toEqual(['T3', 'T1', 'T2'])
    expect(lista[0]).toContain('1 raport de uscare deschis')
    await u.apasa(u.buton('T3 — Gama'))
    expect(u.text()).toContain('Tronson P3')
    // raport deschis: ieșirea trece prin „← Lista” din ecranul de uscare (întreabă la modificări nesalvate), nu prin „Înapoi”-ul exterior
    await u.apasa(u.buton('Tronson P3'))
    expect(u.areButon('Înapoi')).toBe(false)
    await u.apasa(u.buton('← Lista'))
    expect(u.areButon('Înapoi')).toBe(true)
    await u.apasa(u.buton('Înapoi'))
    expect(u.text()).toContain('Alege proiectul')
    await u.apasa(u.buton('Înapoi'))
    expect(u.areButon('Uscare')).toBe(true)
  })

  it('L18: verificarea eșuată se ARATĂ (nu „fără drept” în tăcere) și „Reîncearcă” o reia', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1)], drept: new Map([[1, 'eroare']]) })
    const u = await monteaza(fc)
    expect(u.areButon('Uscare\nconductă')).toBe(false)
    expect(u.text()).toContain('nu am putut verifica dreptul (Failed to fetch)')
    fc.st.drept.set(1, true)
    await u.apasa(u.buton('Reîncearcă'))
    expect(u.text()).not.toContain('nu am putut verifica')
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).toContain('T1 — Proiect test 1')
  })

  it('L24: proiectul schimbat cât primul încă se încarcă -> pe ecran rămân DOAR datele proiectului nou', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1, { nume: 'Alfa' }), PROIECT(2, { nume: 'Beta' })], uscari: [USCARE(11, 1), USCARE(21, 2)],
      drept: new Map([[1, true], [2, true]]) })
    const u = await monteaza(fc)
    // de acum, citirea rapoartelor proiectului 1 din ecranul de uscare rămâne „în zbor”
    fc.st.amana = (tabel, f) => tabel === 'executie_uscari' && f.eq.some(([c, v]) => c === 'proiect_id' && v === 1)
    await u.apasa(u.buton('Uscare'))
    await u.apasa(u.buton('T1 — Alfa'))
    expect(u.text()).toContain('Se încarcă')
    expect(fc.st.cereri.length).toBe(1)
    await u.apasa(u.buton('Înapoi'))
    await u.apasa(u.buton('T2 — Beta'))
    expect(u.text()).toContain('Tronson P2')
    await u.elibereaza(fc.st.cereri[0])          // răspunsul întârziat al proiectului 1 sosește acum
    expect(u.text()).toContain('Tronson P2')
    expect(u.text()).not.toContain('Tronson P1')
    expect(u.text()).toContain('T2 — Beta')
  })
})
