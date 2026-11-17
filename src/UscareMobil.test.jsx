// Teste de componentă: lansatorul de telefon (/m, AppMobilManageri REAL) cu butonul „Uscare conductă”, ecranul de uscare REAL
// (UscareConducta) și ecranul de probe REAL (ProbeTerenMobil), montate cu react-dom în jsdom, pe un client Supabase FALS. Fără rețea,
// fără librării noi. Date SINTETICE.
// jsdom nu e dependență a proiectului (ca la src/UscareConducta.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR; fără el,
// suita e SĂRITĂ VIZIBIL.
// Ce probează (runda 2): la deschiderea lansatorului NU se enumeră proiecte și nu se cer drepturi pe proiect (doar o citire a rândului
// propriu de modul); butonul apare după dreptul pe modulul Execuție; la apăsare se verifică doar proiectele ACTIVE, cu aceeași funcție ca
// ecranul de uscare (fn_executie_nod_drept(proiect, true)); niciun drept = mesaj clar; un proiect -> direct ecranul; mai multe -> lista;
// o verificare eșuată se arată și se reîncearcă (L18); paginarea se oprește la ieșire și un răspuns vechi sosit ultimul se ignoră (L24);
// butoanele existente (și „Probe presiune”, cu și fără dreptul probelor) rămân la locul lor.
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
// ce nu ține de uscare / probe (vremea, PDF-ul raportului zilnic, rezumatul) — înlocuit cu nimic. ProbeTerenMobil rămâne REAL.
vi.mock('./Meteo.jsx', () => ({ MeteoBadge: () => null }))
vi.mock('./MeteoZiXweather.jsx', () => ({ default: () => null }))
vi.mock('./raportDistributiePdf.js', () => ({ exportRaportDistributiePDF: async () => {} }))
vi.mock('./RubricaRezumat.jsx', () => ({ default: () => null }))
vi.mock('./uscarePdf.js', () => ({ exportRaportUscarePDF: async () => ({ necitite: 0 }) }))
import { MemoryRouter } from 'react-router-dom'
import AppMobilManageri from './AppMobilManageri.jsx'
import { useUscareMobil } from './UscareMobil.jsx'

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

// drept: Map proiect -> true | false | 'eroare'; nivel = access_level pe 'executie' (null = fără rând, 'eroare' = citire eșuată);
// probe = dreptul probelor pe teren; st.amana(tabel, filtre) = true -> citirea așteaptă eliberarea manuală (st.cereri), cu datele din
// MOMENTUL cererii (ca un server real: răspunsul vechi poartă starea veche); st.citiri = toate citirile, în ordine
function clientFals({ proiecte = [], uscari = [], drept = new Map(), nivel = 'editor', owner = false, probe = false } = {}) {
  const T = {
    profiles: [{ id: 'u1', name: 'TEST SANTIER', role: 'sef_santier', is_owner: owner }],
    profile_sites: [], sites: [], executie_proiecte: proiecte, executie_uscari: uscari, executie_probe_tronsoane: [],
    user_module_access: nivel && nivel !== 'eroare' ? [{ id: 1, profile_id: 'u1', module: 'executie', access_level: nivel }] : [],
  }
  const st = { drept, nivel, probe, amana: () => false, cereri: [], rpc: [], citiri: [] }
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000, unul: false }
    const calc = () => {
      if (tabel === 'user_module_access' && st.nivel === 'eroare') return { data: null, error: { message: 'Failed to fetch' } }
      const r = (T[tabel] || []).filter(x => f.eq.every(([c, v]) => x[c] === v) && (f.gt == null || x.id > f.gt)).sort((a, b) => (a.id > b.id ? 1 : -1)).slice(0, f.lim).map(x => ({ ...x }))
      return { data: f.unul ? r[0] || null : r, error: null }
    }
    const q = {
      select: () => q, order: () => q, in: () => q, lt: () => q, is: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q }, limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      maybeSingle: () => { f.unul = true; return q }, single: () => { f.unul = true; return q },
      then: (res, rej) => {
        st.citiri.push({ tabel, eq: [...f.eq], gt: f.gt })
        if (st.amana(tabel, f)) { const snap = calc(); const d = amana(); st.cereri.push({ tabel, eq: f.eq, gt: f.gt, ...d }); return d.p.then(() => snap).then(res, rej) }
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
      if (fn === 'probe_teren_drept') return { data: st.probe === true, error: null }
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
const enumerari = fc => fc.st.citiri.filter(c => c.tabel === 'executie_proiecte' || (c.tabel === 'executie_uscari' && !c.eq.some(([k]) => k === 'proiect_id')))
const verificari = fc => fc.st.rpc.filter(r => r.fn === 'fn_executie_nod_drept')

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(fc, element = <MemoryRouter><AppMobilManageri /></MemoryRouter>) {
  fals.cur = fc.client
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), sessionStorage: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage') }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  Object.defineProperty(globalThis, 'localStorage', { value: stocareFalsa(), configurable: true, writable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: stocareFalsa(), configurable: true, writable: true })
  j.window.confirm = () => true
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }) }
  await act(async () => { root.render(element) })
  await asteapta()
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => {
    demonteaza()
    Object.assign(globalThis, { window: vechi.window, document: vechi.document })
    for (const k of ['localStorage', 'sessionStorage']) { if (vechi[k]) Object.defineProperty(globalThis, k, vechi[k]); else delete globalThis[k] }
  })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = text => { const b = butoane().find(x => x.textContent.includes(text) || x.getAttribute('aria-label') === text); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const areButon = text => butoane().some(x => x.textContent.includes(text) || x.getAttribute('aria-label') === text)
  // etichetele butoanelor, cu spațiile normalizate (eticheta lansatorului are „\n”)
  const etichete = () => butoane().map(b => b.textContent.replace(/\s+/g, ' ').trim())
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const elibereaza = async c => { await act(async () => { c.res() }); await asteapta() }
  return { d, act, apasa, buton, areButon, etichete, elibereaza, asteapta, demonteaza, text: () => d.body.textContent }
}

const LANSATOR = ['Raport lucrare', 'Pontaj echipă', 'Raportare problemă', 'Cerere transport']
// pozițiile etichetelor cerute, în ordinea dată (-1 = lipsește)
const pozitii = (et, cerute) => cerute.map(l => et.findIndex(t => t.includes(l)))
const crescator = a => a.every((x, i) => x >= 0 && (i === 0 || x > a[i - 1]))

dom(numeDom('Uscare conductă în lansatorul /m (jsdom + react-dom)'), () => {
  it('runda 2: deschiderea lansatorului NU enumeră proiecte și nu cere drepturi pe proiect (doar rândul propriu de modul)', async () => {
    const fc = clientFals({ proiecte: Array.from({ length: 60 }, (_, i) => PROIECT(i + 1)), drept: new Map([[1, true]]) })
    const u = await monteaza(fc)
    expect(u.areButon('Uscare')).toBe(true)
    expect(enumerari(fc)).toEqual([])
    expect(verificari(fc)).toEqual([])
    expect(fc.st.citiri.filter(c => c.tabel === 'user_module_access').map(c => c.eq)).toEqual([[['profile_id', 'u1'], ['module', 'executie']]])
  })

  it('viewer pe Execuție sau fără rând -> butonul NU apare (și nimic enumerat)', async () => {
    for (const nivel of ['viewer', null]) {
      const fc = clientFals({ proiecte: [PROIECT(1)], drept: new Map([[1, true]]), nivel })
      const u = await monteaza(fc)
      expect(u.text()).toContain('Raport')
      expect(u.areButon('Uscare')).toBe(false)
      expect(enumerari(fc)).toEqual([])
      expect(verificari(fc)).toEqual([])
      curata.pop()()
    }
  })

  it('owner -> butonul apare fără citirea de modul', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1)], nivel: null, owner: true })
    const u = await monteaza(fc)
    expect(u.areButon('Uscare')).toBe(true)
    expect(fc.st.citiri.some(c => c.tabel === 'user_module_access')).toBe(false)
  })

  it('L18: citirea de modul eșuată = necunoscut -> butonul se arată, iar verificarea de la apăsare decide', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1)], drept: new Map([[1, false]]), nivel: 'eroare' })
    const u = await monteaza(fc)
    expect(u.areButon('Uscare')).toBe(true)
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).toContain('Nu ai drept de scriere pe niciun proiect activ de Execuție')
  })

  it('la apăsare: doar proiectele ACTIVE se verifică (arhiva nu, nici cu uscări deschise); niciun drept = mesaj clar, nu ecran gol', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1), PROIECT(2), PROIECT(3, { activ: false })], uscari: [USCARE(31, 3)], drept: new Map([[1, false], [2, false], [3, true]]) })
    const u = await monteaza(fc)
    fc.st.amana = tabel => tabel === 'executie_proiecte' && fc.st.cereri.length === 0
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).toContain('Se verifică proiectele pe care poți lucra')
    await u.elibereaza(fc.st.cereri[0])
    // aceeași funcție ca ecranul de uscare, cu scriere; filtrul „activ” pe server, înaintea paginării
    expect(verificari(fc).map(r => [r.a.p_proiect, r.a.p_scriere]).sort()).toEqual([[1, true], [2, true]])
    expect(fc.st.citiri.filter(c => c.tabel === 'executie_proiecte').every(c => c.eq.some(([k, v]) => k === 'activ' && v === true))).toBe(true)
    expect(u.text()).toContain('Nu ai drept de scriere pe niciun proiect activ de Execuție')
    expect(u.text()).not.toContain('Proiect test 3')
  })

  it('un singur proiect activ cu drept -> duce DIRECT în ecranul de uscare; „Înapoi” = lansatorul', async () => {
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
    const fc = clientFals({ proiecte: [PROIECT(1, { nume: 'Alfa' }), PROIECT(2, { nume: 'Beta' }), PROIECT(3, { nume: 'Gama' })],
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
    await u.apasa(u.buton('Uscare'))
    expect(u.text()).toContain('Nu am putut verifica proiectele pe care poți lucra: Failed to fetch')
    expect(u.text()).not.toContain('Nu ai drept de scriere')
    fc.st.drept.set(1, true)
    await u.apasa(u.buton('Reîncearcă'))
    expect(u.text()).not.toContain('Nu am putut verifica')
    expect(u.text()).toContain('T1 — Proiect test 1')
  })

  it('L24: proiectul schimbat cât primul încă se încarcă -> pe ecran rămân DOAR datele proiectului nou', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1, { nume: 'Alfa' }), PROIECT(2, { nume: 'Beta' })], uscari: [USCARE(11, 1), USCARE(21, 2)],
      drept: new Map([[1, true], [2, true]]) })
    const u = await monteaza(fc)
    await u.apasa(u.buton('Uscare'))
    // de acum, citirea rapoartelor proiectului 1 din ecranul de uscare rămâne „în zbor”
    fc.st.amana = (tabel, f) => tabel === 'executie_uscari' && f.eq.some(([c, v]) => c === 'proiect_id' && v === 1)
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

  it('L24: ieșirea din „Uscare conductă” cât prima pagină e în zbor -> NICIO pagină și NICIO verificare în plus', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1), PROIECT(2)], drept: new Map([[1, true], [2, true]]) })
    const u = await monteaza(fc)
    fc.st.amana = tabel => tabel === 'executie_proiecte' || tabel === 'executie_uscari'
    await u.apasa(u.buton('Uscare'))
    expect(fc.st.cereri.map(c => c.tabel).sort()).toEqual(['executie_proiecte', 'executie_uscari'])
    await u.apasa(u.buton('Înapoi'))
    expect(u.areButon('Uscare')).toBe(true)
    const inainte = fc.st.citiri.length
    for (const c of fc.st.cereri) await u.elibereaza(c)
    expect(fc.st.citiri.length).toBe(inainte)
    expect(verificari(fc)).toEqual([])
  })

  it('L24 (hook): demontare cât prima pagină e în zbor -> paginarea se oprește (fără pagina următoare, fără RPC)', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1)], drept: new Map([[1, true]]) })
    fc.st.amana = tabel => tabel === 'executie_proiecte' && fc.st.cereri.length === 0
    const H = () => { const s = useUscareMobil(fals.client); return <div>{s.stare}</div> }
    const u = await monteaza(fc, <H />)
    expect(fc.st.cereri.length).toBe(1)
    u.demonteaza()
    await u.elibereaza(fc.st.cereri[0])
    expect(fc.st.citiri.filter(c => c.tabel === 'executie_proiecte').map(c => c.gt)).toEqual([null])
    expect(verificari(fc)).toEqual([])
  })

  it('L24 (hook): două reîncărcări suprapuse, răspunsul VECHI sosește ultimul -> se ignoră și paginarea veche se oprește', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1, { nume: 'Vechi' })], drept: new Map([[1, true], [2, true]]) })
    // doar PRIMA pagină a proiectelor rămâne în zbor (cu datele din momentul cererii)
    fc.st.amana = (tabel, f) => tabel === 'executie_proiecte' && f.gt == null
    const ref = {}
    const H = () => { const s = useUscareMobil(fals.client); ref.s = s; return <div id="h">{s.stare}|{s.proiecte.map(p => p.nume).join(',')}</div> }
    const u = await monteaza(fc, <H />)
    expect(fc.st.cereri.length).toBe(1)                     // încărcarea 1 (proiectul „Vechi”)
    fc.T.executie_proiecte = [PROIECT(2, { nume: 'Nou' })]
    await u.act(async () => { ref.s.reincarca() })
    await u.asteapta()
    expect(fc.st.cereri.length).toBe(2)                     // încărcarea 2 (proiectul „Nou”)
    await u.elibereaza(fc.st.cereri[1])                     // întâi răspunsul nou
    expect(u.d.getElementById('h').textContent).toBe('gata|Nou')
    const pagini = () => fc.st.citiri.filter(c => c.tabel === 'executie_proiecte').length
    const inainte = pagini(), rpcInainte = verificari(fc).length
    await u.elibereaza(fc.st.cereri[0])                     // apoi cel vechi
    expect(u.d.getElementById('h').textContent).toBe('gata|Nou')
    expect(pagini()).toBe(inainte)                          // încărcarea veche nu mai cere pagina următoare
    expect(verificari(fc).length).toBe(rpcInainte)          // și nici verificări
    expect(verificari(fc).map(r => r.a.p_proiect)).toEqual([2])
  })

  it('regresie: fără dreptul probelor -> butoanele existente la locul lor, fără „Probe presiune”', async () => {
    const fc = clientFals({ proiecte: [PROIECT(1)], probe: false })
    const u = await monteaza(fc)
    expect(crescator(pozitii(u.etichete(), [...LANSATOR, 'Uscare conductă']))).toBe(true)
    expect(u.areButon('Probe presiune')).toBe(false)
    expect(fc.st.rpc.filter(r => r.fn === 'probe_teren_drept').map(r => r.a)).toEqual([{ p_scriere: true }])
  })

  it('regresie: cu dreptul probelor -> „Probe presiune” rămâne după butoanele lansatorului și deschide ecranul REAL de probe', async () => {
    for (const nivel of ['editor', null]) {
      const fc = clientFals({ proiecte: [PROIECT(1)], probe: true, nivel })
      const u = await monteaza(fc)
      const cerute = nivel ? [...LANSATOR, 'Uscare conductă', 'Probe presiune'] : [...LANSATOR, 'Probe presiune']
      expect(crescator(pozitii(u.etichete(), cerute))).toBe(true)
      expect(u.areButon('Uscare')).toBe(nivel != null)
      await u.apasa(u.buton('Probe presiune'))
      expect(u.d.querySelector('h1')?.textContent).toContain('Probe presiune')
      expect(u.areButon('Inapoi la /m')).toBe(true)
      expect(u.text()).not.toContain('Raportare problemă')
      await u.apasa(u.buton('Inapoi la /m'))
      expect(crescator(pozitii(u.etichete(), cerute))).toBe(true)
      expect(enumerari(fc).filter(c => c.tabel === 'executie_uscari')).toEqual([])   // ecranul de probe nu pornește uscarea
      curata.pop()()
    }
  })
})
