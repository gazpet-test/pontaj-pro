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
// PDF-ul real cere canvas (nu există în jsdom): se înregistrează doar argumentele exportului (consimțământul coordonatelor)
const exporturi = []
vi.mock('./uscarePdf.js', () => ({ exportRaportUscarePDF: async a => { exporturi.push({ id: a.uscare.id, cuCoordonate: a.cuCoordonate }); return { necitite: 0 } } }))
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
function clientFals({ rapoarte = [], incarcari = [], sites = [], meteo = [] } = {}) {
  const T = {
    executie_uscari: new Map(rapoarte.map(r => [r.id, { ...r }])), executie_uscare_jurnal: new Map(),
    executie_uscare_incarcari: new Map(incarcari.map(i => [i.id, { ...i }])), executie_uscare_poze: new Map(),
    sites: new Map(sites.map(s => [s.id, { ...s }])), meteo_cache: new Map(meteo.map(m => [m.site_id, { id: m.site_id, ...m }])),
    fisiere: new Set(),
  }
  // st.amanaTabel: tabelele ale căror citiri așteaptă eliberarea manuală (st.cereriTabel) — răspunsuri „în zbor”
  const st = { rpc: [], auto: true, amanaTabel: new Set(), cereriTabel: [], retrageEroare: false }
  let idNou = 100
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q, in: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        const calc = () => ({ data: [...(T[tabel] || new Map()).values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r })), error: null })
        if (st.amanaTabel.has(tabel)) { const d = amana(); st.cereriTabel.push({ tabel, ...d }); return d.p.then(calc).then(res, rej) }
        return Promise.resolve(calc()).then(res, rej)
      },
    }
    return q
  }
  const jurnal = (cheie, uscare_id, actiune) => T.executie_uscare_jurnal.set(++idNou, { id: idNou, cheie, uscare_id, actiune, proiect_id: 1 })
  // serverul FALS: cheia apăsării (duplicat; retrasă = refuz), CAS pe versiune (conflict cu rândul curent), creare, poza din rezervare, retragerea
  const aplica = (fn, a) => {
    const j = [...T.executie_uscare_jurnal.values()].find(x => x.cheie === a.p_cheie)
    if (fn === 'fn_executie_uscare_retrage') {
      if (j) return j.actiune === 'cheie_retrasa' ? { ok: true, duplicat: true, aplicat: false, retrasa: true } : { ok: true, duplicat: true, aplicat: true, retrasa: false, actiune: j.actiune, uscare_id: j.uscare_id }
      jurnal(a.p_cheie, null, 'cheie_retrasa')
      return { ok: true, duplicat: false, aplicat: false, retrasa: true }
    }
    if (j?.actiune === 'cheie_retrasa') return { __eroare: { code: '22023', message: 'uscare: cererea a fost retrasă (Renunț) și nu se mai aplică' } }
    if (j) return { ok: true, duplicat: true, uscare: { ...T.executie_uscari.get(j.uscare_id) } }
    if (fn === 'fn_executie_uscare_poza' && a.p_actiune === 'adauga') {
      const i = [...T.executie_uscare_incarcari.values()].find(x => x.cale === a.p_cale && x.uscare_id === a.p_uscare && !x.renuntat_la)
      if (!i || !T.fisiere.has(a.p_cale)) return { __eroare: { code: '22023', message: 'uscare: fișierul pozei nu e încărcat' } }
      const p = { id: ++idNou, uscare_id: i.uscare_id, proiect_id: 1, categorie: i.categorie, burete_nr: i.burete_nr, cale: i.cale, legenda: i.legenda, creat_la: '2026-11-10T09:00:00Z' }
      T.executie_uscare_poze.set(p.id, p); jurnal(a.p_cheie, i.uscare_id, 'poza_adaugata')
      return { ok: true, duplicat: false, poza: { ...p } }
    }
    if (fn !== 'fn_executie_uscare_salveaza') throw new Error('rpc necunoscut ' + fn + ' ' + a.p_actiune)
    if (a.p_id == null) {
      const r = RAP(++idNou, { ...a.p_date, versiune: 1 })
      T.executie_uscari.set(r.id, r)
      jurnal(a.p_cheie, r.id, 'creare')
      return { ok: true, duplicat: false, uscare: { ...r } }
    }
    const r = T.executie_uscari.get(a.p_id)
    if (r.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', uscare: { ...r } }
    Object.assign(r, a.p_date, { versiune: r.versiune + 1 })
    jurnal(a.p_cheie, r.id, 'salvare')
    return { ok: true, duplicat: false, uscare: { ...r } }
  }
  const raspuns = x => (x?.__eroare ? { data: null, error: x.__eroare } : { data: x, error: null })
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    from: tabel => interogare(tabel),
    storage: { from: () => ({
      createSignedUrls: async () => ({ data: [], error: null }),
      upload: async cale => { if (T.fisiere.has(cale)) return { data: null, error: { message: 'există deja' } }; T.fisiere.add(cale); return { data: { path: cale }, error: null } },
      download: async cale => (T.fisiere.has(cale) ? { data: new Blob(['x']), error: null } : { data: null, error: { message: 'lipsă' } }),
    }) },
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: true, error: null })
      if (fn === 'fn_executie_contract_drept') return Promise.resolve({ data: false, error: null })
      if (fn === 'fn_executie_uscare_retrage' && st.retrageEroare) return Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      // st.devreme: serverul scrie LA APEL, dar răspunsul se pierde (timeout) la eliberarea cu „eroare”
      const devreme = st.devreme ? aplica(fn, a) : null
      if (st.auto) d.res('ok')
      return d.p.then(mod => (mod === 'eroare' ? { data: null, error: { message: 'timeout simulat' } } : raspuns(devreme || aplica(fn, a))))
    },
  }
  // o cerere pierdută care ajunge la server MAI TÂRZIU (după „Renunț”): direct la serverul fals
  const ajungeTarziu = (fn, a) => raspuns(aplica(fn, a))
  return { client, st, T, ajungeTarziu }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client, stocare = stocareFalsa(), extra = {}) {
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
  await act(async () => { root.render(<UscareConducta proiectId={1} client={client} stocare={stocare} {...extra} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const selecteaza = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  const alegeFisier = async (input, fisier) => {
    Object.defineProperty(input, 'files', { value: [fisier], configurable: true })
    await act(async () => { input.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  const butoane = () => [...d.querySelectorAll('button')]
  const butonExact = text => { const b = butoane().filter(x => x.textContent.trim() === text).at(-1); if (!b) throw new Error('nu găsesc butonul exact ' + text); return b }
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
  return { d, j, apasa, buton, butonExact, butoane, scrie, camp, bifeaza, elibereaza, asteapta, selecteaza, alegeFisier, text: () => d.body.textContent }
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

  // ── runda 3 (verdictul r2) ──
  const creeazaNou = async u => {
    await u.apasa(u.buton('Alt interval / tot traseul'))
    await u.scrie('Tronson (cum apare în raport)', 'Tr. 9')
    await u.scrie('De la km', '0+000')
    await u.scrie('La km', '1+000')
    await u.bifeaza('Confirm constructorul')
    await u.apasa(u.buton('Creează raportul'))
  }
  const cheiIncerte = stocare => [...stocare.m.keys()].filter(k => k.includes('incert'))

  it('P1-3 „Renunț” pe o creare nelămurită APLICATĂ: întâi serverul (după cheie); raportul creat se deschide, nicio a doua creare', async () => {
    const { client, st, T } = clientFals()
    st.auto = false; st.devreme = true
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(T.executie_uscari.size).toBe(1)
    st.auto = true
    await u.apasa(u.butonExact('Renunț'))
    expect(st.rpc.at(-1)).toMatchObject({ fn: 'fn_executie_uscare_retrage', a: { p_proiect: 1, p_cheie: st.rpc[0].a.p_cheie } })
    expect(u.text()).toContain('se aplicase deja')
    expect(cheiIncerte(stocare)).toHaveLength(0)
    expect(() => u.buton('Creează raportul')).toThrow()                       // formularul „nou” nu mai poate emite altă creare
    expect(u.camp('Tronson (cum apare în raport)').value).toBe('Tr. 9')       // e deschis raportul creat
    expect(T.executie_uscari.size).toBe(1)
    expect([...T.executie_uscare_jurnal.values()].some(x => x.actiune === 'cheie_retrasa')).toBe(false)
  })

  it('P1-3 „Renunț” pe o creare care NU ajunsese: retrasă definitiv pe server; dacă ajunge mai târziu e refuzată (fără dublură)', async () => {
    const { client, st, T, ajungeTarziu } = clientFals()
    st.auto = false
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(T.executie_uscari.size).toBe(0)
    st.auto = true
    await u.apasa(u.butonExact('Renunț'))
    expect(u.text()).toContain('am retras-o definitiv')
    expect(cheiIncerte(stocare)).toHaveLength(0)
    const tarziu = ajungeTarziu('fn_executie_uscare_salveaza', st.rpc[0].a)
    expect(tarziu.error?.code).toBe('22023')
    expect(T.executie_uscari.size).toBe(0)
  })

  it('P1-3 (aceeași cale) retrimiterea identică DIN formularul „nou”, aplicată: se deschide raportul creat, „Creează” nu mai e disponibil', async () => {
    const { client, st, T } = clientFals()
    st.auto = false; st.devreme = true
    const u = await monteaza(client)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    st.auto = true
    await u.apasa(u.buton('Retrimite identic'))
    expect(u.text()).toContain('se salvase deja')
    expect(() => u.buton('Creează raportul')).toThrow()
    expect(T.executie_uscari.size).toBe(1)
  })

  it('P1-3 „Renunț” fără răspuns SIGUR de la server: cheia rămâne, creare nouă tot blocată', async () => {
    const { client, st } = clientFals()
    st.auto = false; st.devreme = true
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    st.retrageEroare = true
    await u.apasa(u.butonExact('Renunț'))
    expect(u.text()).toContain('rămâne de lămurit')
    expect(cheiIncerte(stocare)).toHaveLength(1)
    expect(u.buton('Lămurește cererea de sus').disabled).toBe(true)
  })

  const SITE = [{ id: 100, name: 'Santier P1', proiect_id: 1 }]
  const METEO = la => [{ site_id: 100, curent: { temp: 7.46, vreme: 'Senin', la }, actualizat_la: la, sursa: 'xweather' }]

  it('P2-5 corectarea temperaturii ÎNAINTEA primei salvări păstrează valoarea automată (cererea meteo pleacă la server)', async () => {
    const { client, st } = clientFals({ rapoarte: [RAP(1, { ora_inceput: '2026-11-10T07:00:00Z' })], sites: SITE, meteo: METEO('2026-11-10T07:30:00Z') })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    await u.apasa(u.buton('Din meteo'))
    expect(u.camp('Temperatura exterioară (°C)').value).toBe('7,5')
    await u.scrie('Temperatura exterioară (°C)', '9')
    expect(u.text()).toContain('Valoarea automată propusă se păstrează')
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc[0].a.p_date).toMatchObject({ temperatura_c: 9, temperatura_sursa: 'manual', meteo: { cerere: 'santier', site_id: 100 } })
  })

  it('P2-6 răspunsul meteo în zbor se IGNORĂ dacă între timp s-a schimbat ora începerii sau poziția', async () => {
    for (const schimbare of [u => u.scrie('Ora începerii', '2026-11-10T11:00'), u => u.scrie('Latitudine', '44,95')]) {
      const { client, st } = clientFals({ rapoarte: [RAP(1, { ora_inceput: '2026-11-10T07:00:00Z' })], sites: SITE, meteo: METEO('2026-11-10T07:30:00Z') })
      st.amanaTabel.add('meteo_cache')
      const u = await monteaza(client)
      await u.apasa(u.buton('Tr. test'))
      await u.apasa(u.buton('Din meteo'))
      expect(st.cereriTabel).toHaveLength(1)
      await schimbare(u)
      await u.elibereaza(st.cereriTabel[0], 'ok')
      expect(u.camp('Temperatura exterioară (°C)').value).toBe('')
    }
  })

  it('P2-6 ora de iarnă: alegerea CELEILALTE apariții invalidează propunerea (în zbor și deja aplicată)', async () => {
    const { client, st } = clientFals({ rapoarte: [RAP(1, { ora_inceput: '2026-10-25T00:30:00Z' })], sites: SITE, meteo: METEO('2026-10-25T00:00:00Z') })
    st.amanaTabel.add('meteo_cache')
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    const aparitie = () => [...u.d.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'iarna'))
    expect(aparitie().value).toBe('vara')
    await u.apasa(u.buton('Din meteo'))
    await u.selecteaza(aparitie(), 'iarna')
    await u.elibereaza(st.cereriTabel[0], 'ok')
    expect(u.camp('Temperatura exterioară (°C)').value).toBe('')
    st.amanaTabel.clear()
    await u.apasa(u.buton('Din meteo'))
    expect(u.camp('Temperatura exterioară (°C)').value).toBe('7,5')
    await u.selecteaza(aparitie(), 'vara')
    expect(u.camp('Temperatura exterioară (°C)').value).toBe('')
  })

  it('P2-6 două capturi GPS care răspund în ordine inversă: rămâne ULTIMA cerută', async () => {
    const cereri = []
    const vechi = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'navigator', { value: { geolocation: { getCurrentPosition: (ok, nu) => cereri.push({ ok, nu }) } }, configurable: true, writable: true })
    curata.push(() => { if (vechi) Object.defineProperty(globalThis, 'navigator', vechi); else delete globalThis.navigator })
    const { client } = clientFals({ rapoarte: [RAP(1)] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    await u.apasa(u.buton('Poziția mea (GPS'))
    await u.apasa(u.buton('Poziția mea (GPS'))
    const poz = (lat, lng) => ({ coords: { latitude: lat, longitude: lng, accuracy: 5 }, timestamp: Date.parse('2026-11-10T08:00:00Z') })
    await u.elibereaza({ res: () => cereri[1].ok(poz(44.95, 22.51)) })
    await u.elibereaza({ res: () => cereri[0].ok(poz(45.1, 23.2)) })
    expect([u.camp('Latitudine').value, u.camp('Longitudine').value]).toEqual(['44,95', '22,51'])
  })

  it('P2-7 după refresh, o rezervare fără fișier primește fișierul din ecran (aceeași cale, fără rezervare nouă)', async () => {
    const cale = '1/1/0f0e0d0c-0000-4000-8000-000000000001.jpg'
    const { client, st, T } = clientFals({ rapoarte: [RAP(1)], incarcari: [{ id: 7, uscare_id: 1, proiect_id: 1, cale, categorie: 'manometru', burete_nr: null, legenda: null, renuntat_motiv: null, renuntat_la: null, creat_la: '2026-11-10T08:30:00Z' }] })
    const u = await monteaza(client, stocareFalsa(), { comprima: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) })
    await u.apasa(u.buton('Tr. test'))
    expect(u.text()).toContain('Încărcări de fotografii nelămurite')
    const input = u.d.querySelector('input[type="file"][aria-label^="Fișierul rezervării"]')
    expect(input).not.toBeNull()
    await u.alegeFisier(input, new u.j.window.File(['x'], 'poza.jpg', { type: 'image/jpeg' }))
    expect(T.fisiere.has(cale)).toBe(true)
    expect([...T.executie_uscare_poze.values()].map(p => p.cale)).toEqual([cale])
    expect(st.rpc.map(r => r.a.p_actiune)).toEqual(['adauga'])
    expect(u.text()).not.toContain('Încărcări de fotografii nelămurite')
  })

  it('observația 9: bifa „coordonatele în PDF” ține doar pentru raportul și exportul pentru care s-a dat', async () => {
    exporturi.length = 0
    const { client } = clientFals({ rapoarte: [RAP(1, { tronson: 'Tr. A' }), RAP(2, { tronson: 'Tr. B' })] })
    const u = await monteaza(client)
    const bifa = () => [...u.d.querySelectorAll('label')].find(l => l.textContent.includes('Include coordonatele exacte')).querySelector('input')
    await u.apasa(u.buton('Tr. A'))
    await u.bifeaza('Include coordonatele exacte')
    expect(bifa().checked).toBe(true)
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tr. B'))
    expect(bifa().checked).toBe(false)
    await u.apasa(u.buton('Raportul în PDF'))
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tr. A'))
    await u.bifeaza('Include coordonatele exacte')
    await u.apasa(u.buton('Raportul în PDF'))
    expect(exporturi).toEqual([{ id: 2, cuCoordonate: false }, { id: 1, cuCoordonate: true }])
    expect(bifa().checked).toBe(false)                                        // după export, consimțământul nu rămâne pentru următorul
  })

  it('P1-4 conflict la ora de iarnă: colegul mută începutul pe a doua apariție a orei 03:30 -> alegere explicită, nu suprascriere', async () => {
    const { client, st, T } = clientFals({ rapoarte: [RAP(1, { ora_inceput: '2026-10-25T00:30:00Z', versiune: 1 })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    Object.assign(T.executie_uscari.get(1), { ora_inceput: '2026-10-25T01:30:00Z', versiune: 2 })
    await u.scrie('Observații', 'doar observații')
    await u.apasa(u.buton('💾 Salvează'))
    expect(u.text()).toContain('Al colegului: 25.10.2026 03:30 (ora de iarnă)')
    expect(u.buton('Am ales').disabled).toBe(true)
    await u.apasa(u.buton('Al colegului: 25.10.2026 03:30 (ora de iarnă)'))
    await u.apasa(u.buton('Am ales'))
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 2, p_date: { ora_inceput: '2026-10-25T01:30:00.000Z', observatii: 'doar observații' } })
  })
})
