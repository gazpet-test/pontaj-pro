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
// PDF-ul real cere canvas (nu există în jsdom): implicit se înregistrează doar argumentele exportului (consimțământul coordonatelor).
// Runda 6: cu pdfSt.real = true rulează EXPORTATORUL REAL (uscarePdf.js), cu jsPDF / html2canvas falși: descărcările ajung în pdfSt.salvari.
const exporturi = []
const pdfSt = vi.hoisted(() => ({ real: false, salvari: [] }))
vi.mock('./uscarePdf.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, exportRaportUscarePDF: async a => {
    if (pdfSt.real) return real.exportRaportUscarePDF(a)
    exporturi.push({ id: a.uscare.id, cuCoordonate: a.cuCoordonate }); return { necitite: 0 }
  } }
})
vi.mock('jspdf', () => ({ default: class { setProperties() {} addPage() {} addImage() {} getNumberOfPages() { return 1 } save(n) { pdfSt.salvari.push(n) } } }))
vi.mock('html2canvas', () => ({ default: async () => ({ width: 1476, height: 300, toDataURL: () => 'data:image/jpeg;base64,AA==' }) }))
import UscareConducta from './UscareConducta.jsx'
import { lipsaDinRand, incarcariDeschise } from './uscareLogica.js'
// preîncărcat: importul dinamic din ecran (`await import('./uscarePdf.js')`) se rezolvă apoi imediat, ca în aplicație după primul export
await import('./uscarePdf.js')

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
        if (st.eroareTabel?.has(tabel)) return Promise.resolve({ data: null, error: { message: 'eroare simulată' } }).then(res, rej)
        const calc = () => ({ data: [...(T[tabel] || new Map()).values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r })), error: null })
        if (st.amanaTabel.has(tabel)) { const d = amana(); st.cereriTabel.push({ tabel, ...d }); return d.p.then(calc).then(res, rej) }
        return Promise.resolve(calc()).then(res, rej)
      },
    }
    return q
  }
  const jurnal = (cheie, uscare_id, actiune) => T.executie_uscare_jurnal.set(++idNou, { id: idNou, cheie, uscare_id, actiune, proiect_id: 1, creat_de: 'u1' })
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
    // pașii (runda „ecran pe pași”): rezervarea căii pozei și tranziția de stare, ca serverul (închiderea cere lipsaDinRand gol)
    if (fn === 'fn_executie_uscare_poza' && a.p_actiune === 'rezerva') {
      const i = { id: ++idNou, uscare_id: a.p_uscare, proiect_id: 1, cale: a.p_cale, categorie: a.p_categorie, burete_nr: a.p_burete_nr, legenda: null,
        renuntat_motiv: null, renuntat_la: null, creat_la: '2026-11-17T08:00:00Z' }
      T.executie_uscare_incarcari.set(i.id, i); jurnal(a.p_cheie, a.p_uscare, 'rezervare')
      return { ok: true, duplicat: false, incarcare: { ...i } }
    }
    if (fn === 'fn_executie_uscare_stare') {
      const r = T.executie_uscari.get(a.p_id)
      if (r.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', uscare: { ...r } }
      const pz = [...T.executie_uscare_poze.values()].filter(p => p.uscare_id === r.id)
      const inc = [...T.executie_uscare_incarcari.values()].filter(i => i.uscare_id === r.id)
      if (a.p_actiune === 'inchide' && lipsaDinRand(r, pz, incarcariDeschise(inc, pz).length).length) return { __eroare: { code: '22023', message: 'uscare: raportul nu e complet' } }
      Object.assign(r, { stare: { inchide: 'inchisa', anuleaza: 'anulata', redeschide: 'deschisa' }[a.p_actiune], inchis_la: a.p_actiune === 'inchide' ? '2026-11-17T09:30:00Z' : null, versiune: r.versiune + 1 })
      jurnal(a.p_cheie, r.id, a.p_actiune)
      return { ok: true, duplicat: false, uscare: { ...r } }
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
    Object.assign(r, a.p_date, { versiune: r.versiune + 1 }, st.ceas ? { modificat_la: new Date(st.ceas()).toISOString() } : {})
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
  // testele vechi probează formularul complet („Vezi / corectează toate datele”); cele ale pașilor trec { ecranInitial: 'pasi' }
  await act(async () => { root.render(<UscareConducta proiectId={1} client={client} stocare={stocare} ecranInitial="complet" {...extra} />) })
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
  // schimbarea proiectului (alt proiectId pe ACEEAȘI componentă montată, ca la navigarea din Execuție)
  const reranda = async extra2 => { await act(async () => { root.render(<UscareConducta proiectId={1} client={client} stocare={stocare} ecranInitial="complet" {...extra} {...extra2} />) }); await asteapta() }
  // pașii: câmpurile repetate pe piston, butoanele de cameră după text, dublul click în ACELAȘI act (fără randare între apăsări)
  const campuri = eticheta => [...d.querySelectorAll('label')].filter(x => x.querySelector('span')?.textContent.startsWith(eticheta)).map(l => l.querySelector('input, textarea'))
  const scrieEl = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const camere = text => [...d.querySelectorAll('label')].filter(l => l.textContent.includes(text) && l.querySelector('input[type=file]')).map(l => l.querySelector('input[type=file]'))
  const fotografiaza = async (text, i = 0) => { await alegeFisier(camere(text)[i], { name: 'p.jpg', type: 'image/jpeg' }); await asteapta(); await asteapta() }
  const dublu = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })); el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  return { d, j, apasa, buton, butonExact, butoane, scrie, camp, bifeaza, elibereaza, asteapta, selecteaza, alegeFisier, reranda, campuri, scrieEl, camere, fotografiaza, dublu, text: () => d.body.textContent }
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
    // runda 5: „Renunț” trimite INTENȚIA din registru (RPC + parametrii exacți ai cererii), nu un proiect declarat
    const { p_cheie: cheie0, ...args0 } = st.rpc[0].a
    expect(st.rpc.at(-1).fn).toBe('fn_executie_uscare_retrage')
    expect(st.rpc.at(-1).a).toEqual({ p_rpc: 'fn_executie_uscare_salveaza', p_args: args0, p_cheie: cheie0 })
    expect(args0).toMatchObject({ p_proiect: 1, p_id: null, p_versiune: null })
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

  // ── runda 4 (verdictul r3, P2-3): răspunsurile întârziate nu se aplică după navigare / schimbarea proiectului ──
  const elibereazaTabel = async (u, st, tabel) => {
    for (let i = 0; i < 20; i++) {
      const x = st.cereriTabel.find(c => c.tabel === tabel && !c.gata)
      if (!x) return
      x.gata = true; await u.elibereaza(x, 'ok')
    }
  }

  it('P2-3 retrimiterea unei creări aplicate: „← Lista” cât se reîncarcă lista -> raportul vechi NU se mai deschide (reproducerea din verdict)', async () => {
    const { client, st, T } = clientFals()
    st.auto = false; st.devreme = true
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    st.auto = true; st.amanaTabel.add('executie_uscari')
    await u.apasa(u.buton('Retrimite identic'))
    // 1. reconcilierea găsește raportul creat (citirea lui e în zbor) -> eliberată
    const citire = st.cereriTabel.find(c => c.tabel === 'executie_uscari')
    expect(citire).toBeTruthy()
    citire.gata = true; await u.elibereaza(citire, 'ok')
    // 2. funcția așteaptă reîncărcarea listei; 3. contextul se schimbă prin navigare
    expect(st.cereriTabel.some(c => c.tabel === 'executie_uscari' && !c.gata)).toBe(true)
    await u.apasa(u.buton('← Lista'))
    // 4. reîncărcarea se termină; 5. raportul vechi NU se deschide
    await elibereazaTabel(u, st, 'executie_uscari')
    expect(() => u.camp('Tronson (cum apare în raport)')).toThrow()
    expect(u.text()).not.toContain('se salvase deja')
    expect(T.executie_uscari.size).toBe(1)
    expect(cheiIncerte(stocare)).toHaveLength(0)                              // rezultatul DOVEDIT scoate totuși cheia din registrul cererii
  })

  it('P2-3 „Renunț” pe o creare aplicată, cu navigare cât serverul răspunde: cheia iese din registru, dar raportul NU se deschide peste listă', async () => {
    const { client, st } = clientFals()
    st.auto = false; st.devreme = true
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await creeazaNou(u)
    await u.elibereaza(st.rpc[0], 'eroare')
    await u.apasa(u.butonExact('Renunț'))
    const retragere = st.rpc.at(-1)
    expect(retragere.fn).toBe('fn_executie_uscare_retrage')
    await u.apasa(u.buton('← Lista'))
    await u.elibereaza(retragere, 'ok')
    expect(() => u.camp('Tronson (cum apare în raport)')).toThrow()
    expect(u.text()).not.toContain('se aplicase deja')
    expect(cheiIncerte(stocare)).toHaveLength(0)
  })

  it('P2-3 retrimiterea în zbor + schimbarea PROIECTULUI: răspunsul vechi nu scrie mesajul și nu pune lista proiectului vechi peste cel nou', async () => {
    const { client, st, T } = clientFals({ rapoarte: [RAP(1, { tronson: 'Tr. P1' }), RAP(2, { proiect_id: 2, tronson: 'Tr. P2' })] })
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('Tr. P1'))
    await u.scrie('Observații', 'salvare pierdută')
    st.auto = false
    await u.apasa(u.buton('💾 Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')
    await u.apasa(u.buton('Retrimite identic'))
    const retrimitere = st.rpc.at(-1)
    expect(retrimitere.a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    await u.reranda({ proiectId: 2 })
    expect(u.text()).toContain('Tr. P2')
    await u.elibereaza(retrimitere, 'ok')
    expect(T.executie_uscari.get(1).observatii).toBe('salvare pierdută')        // serverul a aplicat retrimiterea
    expect(u.text()).toContain('Tr. P2')
    expect(u.text()).not.toContain('Tr. P1')                                    // lista proiectului vechi NU a înlocuit-o pe cea nouă
    expect(u.text()).not.toContain('Retrimiterea')
    expect(cheiIncerte(stocare)).toHaveLength(0)                                // cheia lămurită iese din registrul proiectului 1
  })

  // ── runda 5 (verdictul r4, P2-3): poza — contextul capturat ÎNAINTEA comprimării, verificat după ea ──
  it('P2-3 poza: proiectul (sau raportul) se schimbă cât se comprimă fotografia -> NIMIC emis, nicio cheie în registrul niciunui proiect (reproducerea din verdict)', async () => {
    for (const schimbare of [u => u.reranda({ proiectId: 2 }), u => u.apasa(u.buton('← Lista'))]) {
      const { client, st } = clientFals({ rapoarte: [RAP(10, { tronson: 'Tr. P1' }), RAP(20, { proiect_id: 2, tronson: 'Tr. P2' })] })
      const stocare = stocareFalsa()
      const comprimari = []
      const u = await monteaza(client, stocare, { comprima: () => { const d = amana(); comprimari.push(d); return d.p } })
      await u.apasa(u.buton('Tr. P1'))
      const input = u.d.querySelector('input[type="file"][capture]')
      expect(input).not.toBeNull()
      // 1. pornește fotografia pentru raportul 10 din P1; 2. comprimarea așteaptă
      await u.alegeFisier(input, new u.j.window.File(['x'], 'poza.jpg', { type: 'image/jpeg' }))
      expect(comprimari).toHaveLength(1)
      // 3. se schimbă proiectul (registrul curent devine P2) / se închide raportul; 4. comprimarea se termină
      await schimbare(u)
      await u.elibereaza(comprimari[0], new Blob(['jpeg'], { type: 'image/jpeg' }))
      // 5. nicio rezervare emisă (pe r4: rezervarea 1/10/K.jpg, cu cheia în registrul P2), nimic în registre, niciun mesaj
      expect(st.rpc.filter(r => r.fn === 'fn_executie_uscare_poza')).toHaveLength(0)
      expect(cheiIncerte(stocare)).toHaveLength(0)
      expect(u.text()).not.toContain('Rezervarea pozei')
    }
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

  // runda 6 (verdict r5 P2): exportatorul REAL, cu citirea pozei AMÂNATĂ; între apăsare și sosirea pozei omul pleacă (listă / alt proiect)
  // -> zero descărcări, niciun mesaj de PDF; citirea în zbor primește semnalul anulat. Martor: fără navigare, exact o descărcare.
  async function pregatestePdfReal({ ignoraAnularea = false } = {}) {
    pdfSt.real = true; pdfSt.salvari.length = 0
    curata.push(() => { pdfSt.real = false; pdfSt.salvari.length = 0 })
    const cereri = []
    vi.stubGlobal('fetch', (url, opt) => {
      const d = amana(), c = { url, opt, ...d }
      cereri.push(c)
      // fetch-ul real respinge la anulare (AbortError); ignoraAnularea = o citire care se termină oricum, după navigare
      if (!ignoraAnularea) opt?.signal?.addEventListener('abort', () => d.res(Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      return d.p
    })
    vi.stubGlobal('FileReader', class { readAsDataURL() { this.result = 'data:image/jpeg;base64,AA=='; queueMicrotask(() => this.onload()) } })
    vi.stubGlobal('requestAnimationFrame', cb => { queueMicrotask(cb); return 1 })
    curata.push(() => vi.unstubAllGlobals())
    const { client, T } = clientFals({ rapoarte: [RAP(1)] })
    T.executie_uscare_poze.set(5, { id: 5, uscare_id: 1, proiect_id: 1, categorie: 'manometru', burete_nr: null, cale: '1/1/a.jpg', legenda: null, creat_la: '2026-11-10T09:00:00Z' })
    client.storage = { from: () => ({ createSignedUrls: async cai => ({ data: cai.map(p => ({ path: p, signedUrl: 'https://stocare.test/' + p })), error: null }) }) }
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    await u.apasa(u.buton('Raportul în PDF'))
    expect(cereri).toHaveLength(1)                                            // exportul așteaptă poza
    const raspuns = { ok: true, status: 200, blob: async () => new Blob(['jpeg'], { type: 'image/jpeg' }) }
    return { u, cereri, elibereaza: () => u.elibereaza(cereri[0], raspuns) }
  }

  it('runda 6: martor — fără navigare, poza amânată sosește și PDF-ul se descarcă o dată', async () => {
    const { u, elibereaza } = await pregatestePdfReal()
    expect(pdfSt.salvari).toHaveLength(0)
    await elibereaza()
    expect(pdfSt.salvari).toHaveLength(1)
    expect(u.text()).toContain('PDF generat.')
  })

  for (const [nume, ignoraAnularea] of [['citirea respinsă la anulare', false], ['citirea care se termină oricum', true]]) {
    it(`runda 6: poza amânată + revenire la listă -> zero descărcări (${nume})`, async () => {
      const { u, cereri, elibereaza } = await pregatestePdfReal({ ignoraAnularea })
      await u.apasa(u.buton('← Lista'))
      const anulataLaNavigare = cereri[0].opt?.signal?.aborted === true
      await elibereaza()
      await u.asteapta()
      expect(pdfSt.salvari).toEqual([])
      expect(u.text()).not.toContain('PDF generat')
      expect(u.text()).not.toContain('PDF-ul nu s-a putut genera')
      expect(anulataLaNavigare).toBe(true)                                     // citirea în zbor e anulată la schimbarea contextului
    })
    it(`runda 6: poza amânată + alt proiect -> zero descărcări (${nume})`, async () => {
      const { u, elibereaza } = await pregatestePdfReal({ ignoraAnularea })
      await u.reranda({ proiectId: 2 })
      await elibereaza()
      await u.asteapta()
      expect(pdfSt.salvari).toEqual([])
      expect(u.text()).not.toContain('PDF generat')
    })
  }

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

  // ── proba pe telefon (17.11.2026) ──
  // Zona butoanelor plutitoare ale platformei, din sursele lor (nu din ecranul testat): 🐛 (BugReportButton) bottom 24 + buton 52 + gap 6 +
  // eticheta „Buuuuuuuug :(” ~24 = ~106 px; asistentul (ChatbotWidget) 24 + 70 = 94; „Tichet” (TichetModulButton) 24 + 52 = 76.
  const ZONA_PLUTITOARE = 106
  const INALTIME_MIN_BARA = 54 + 2 * 10 + 1                                  // ST.mare (54) + padding 10 sus/jos + chenar
  const barapx = v => parseFloat(String(v).replace('px', ''))
  it('proba pe telefon: bara „Salvează” stă deasupra butoanelor plutitoare și formularul lasă jos loc pentru ea', async () => {
    const { client } = clientFals({ rapoarte: [RAP(1)] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    const btn = u.buton('Salvat')
    let bara = btn.parentElement
    while (bara && bara.style.position !== 'fixed') bara = bara.parentElement
    expect(bara, 'bara fixă a salvării').toBeTruthy()
    expect(barapx(bara.style.bottom)).toBeGreaterThanOrEqual(ZONA_PLUTITOARE)   // pe toată lățimea, deasupra zonei plutitoarelor
    expect([bara.style.left, bara.style.right]).toEqual(['0px', '0px'])
    const formular = u.d.getElementById('r').firstElementChild
    const jos = barapx(formular.style.paddingBottom || formular.style.padding.split(' ')[2])
    expect(jos).toBeGreaterThanOrEqual(barapx(bara.style.bottom) + INALTIME_MIN_BARA)   // ultimul câmp poate urca deasupra barei
  })
  it('proba pe telefon: sursele butoanelor plutitoare au încă pozițiile din care e calculată zona (altfel se recalculează)', async () => {
    const fs = await import('node:fs')
    const sursa = f => fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8')
    expect(sursa('BugReportButton.jsx')).toMatch(/position: 'fixed', bottom: 24, left: 24/)
    expect(sursa('BugReportButton.jsx')).toMatch(/width: 52, height: 52/)
    expect(sursa('ChatbotWidget.jsx')).toMatch(/bottom: 24,\s+right: 24,\s+width: 70,\s+height: 70/)
    expect(sursa('TichetModulButton.jsx')).toMatch(/position:'fixed', bottom:24, right:88[\s\S]{0,120}height:52/)
  })
  it('proba pe telefon: raportul ANULAT nu mai arată concluzia (CONFORM) în listă; cel închis o arată', async () => {
    const { client } = clientFals({ rapoarte: [RAP(1, { tronson: 'Tr. anulat', stare: 'anulata', concluzie: 'conform', motiv_anulare: 'probă' }), RAP(2, { tronson: 'Tr. închis', stare: 'inchisa', concluzie: 'conform' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Arată și anulatele'))
    expect(u.buton('Tr. anulat').textContent).toContain('Anulat')
    expect(u.buton('Tr. anulat').textContent).not.toContain('CONFORM')
    expect(u.buton('Tr. închis').textContent).toContain('CONFORM')
  })
  it('proba pe telefon: temperatura și punctul de rouă au tastatura cu semnul minus; valorile negative ajung la server', async () => {
    const { client, st } = clientFals({ rapoarte: [RAP(1)] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Tr. test'))
    for (const e of ['Temperatura exterioară (°C)', 'Valoare (°C)']) expect(u.camp(e).getAttribute('inputmode'), e).toBe('text')
    expect(u.camp('Lungime').getAttribute('inputmode')).toBe('decimal')     // celelalte numere rămân pe tastatura numerică
    await u.scrie('Temperatura exterioară (°C)', '-6,5')
    await u.scrie('Valoare (°C)', '-20,5')
    await u.scrie('Locul măsurării', 'capăt')
    await u.apasa(u.buton('💾 Salvează'))
    expect(st.rpc[0].a.p_date).toMatchObject({ temperatura_c: -6.5, punct_roua_c: -20.5 })
  })
})

// ── ecranul pe PAȘI (telefon): tronson → etapa 1 → oprire → reluare → etapa 2 → rezumat → raport ──
// Pozele trec prin aceleași RPC-uri ca în aplicație (rezervare → fișier → înregistrare); pasul se deduce din rândul serverului fals + poze.
const ORA = (h, m = 0) => Date.UTC(2026, 10, 17, h, m)          // 17.11.2026, ora UTC (România = UTC+2)
const pozaServer = (T, uscare_id, categorie, burete_nr = null) => {
  const id = 900 + T.executie_uscare_poze.size + T.executie_uscare_incarcari.size
  const cale = `1/${uscare_id}/00000000-0000-4000-8000-${String(id).padStart(12, '0')}.jpg`
  T.executie_uscare_incarcari.set(id, { id, uscare_id, proiect_id: 1, cale, categorie, burete_nr, legenda: null, renuntat_motiv: null, renuntat_la: null, creat_la: '2026-11-17T08:00:00Z' })
  T.executie_uscare_poze.set(id, { id, uscare_id, proiect_id: 1, categorie, burete_nr, cale, legenda: null, creat_la: '2026-11-17T08:00:00Z' })
}
// un raport cu etapa 1 completă pe server (2 pistoane, intrările 1,25 / 1,30 kg, pozele etapei)
const etapa1Gata = (T, id, extra = {}) => {
  T.executie_uscari.set(id, RAP(id, { bureti_buc: 2, cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: null, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: null, motiv: null }],
    ora_inceput: '2026-11-17T08:00:00Z', data_operatie: '2026-11-17', ...extra }))
  pozaServer(T, id, 'cantar_intrare', 1); pozaServer(T, id, 'cantar_intrare', 2); pozaServer(T, id, 'pistoane')
}
const salvari = st => st.rpc.filter(r => r.fn === 'fn_executie_uscare_salveaza')

dom(numeDom('UscareConducta — ecranul pe pași (jsdom + react-dom)'), () => {
  it('parcursul complet: etapa 1 -> oprire -> reluare din ALTĂ sesiune -> etapa 2 -> rezumat -> „Generează raportul” (închidere + PDF)', async () => {
    const { client, st, T } = clientFals()
    let ceas = ORA(8)
    st.ceas = () => ceas
    const ex = { ecranInitial: 'pasi', acum: () => ceas, comprima: async () => new Blob(['x']) }
    const u = await monteaza(client, stocareFalsa(), ex)
    // pasul 0: tronsonul (km și lungimea), nimic altceva
    await u.apasa(u.buton('Uscare nouă'))
    expect(u.text()).toContain('Pe ce tronson faci uscarea?')
    expect(u.buton('Începe').disabled).toBe(true)
    await u.scrie('Tronson (cum apare în raport)', 'Tr. pași')
    await u.scrie('De la km', '0+000')
    await u.scrie('La km', '1+000')
    expect(u.camp('Lungime (m)').value).toBe('1000')
    await u.apasa(u.buton('Începe'))
    expect(T.executie_uscari.size).toBe(1)
    const id = [...T.executie_uscari.keys()][0]
    expect(T.executie_uscari.get(id)).toMatchObject({ tronson: 'Tr. pași', lungime_m: 1000, bureti_buc: 2, data_operatie: '2026-11-17', constructor: 'GAZPET INSTAL S.R.L.' })
    // etapa 1: butonul inactiv spune EXACT ce lipsește
    expect(u.text()).toContain('Etapa 1 din 2')
    expect(u.buton('Înregistrează etapa 1').disabled).toBe(true)
    for (const t of ['greutatea pistonului 1 la intrare', 'poza cântarului pentru pistonul 2 (intrare)', 'poza ansamblului de pistoane']) expect(u.text()).toContain(t)
    expect(u.text()).not.toContain('ora introducerii,')                        // ora goală = „acum”, la apăsare
    const kg = u.campuri('Greutatea pe cântar, la intrare')
    expect(kg).toHaveLength(2)
    expect(kg[0].getAttribute('inputmode')).toBe('decimal')
    await u.scrieEl(kg[0], '1250')                                               // grame din greșeală: avertisment, nu blocare
    expect(u.text()).toContain('pare scris în GRAME')
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,25')
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[1], '1,30')
    expect(u.text()).toContain('= 1.250 g')
    await u.fotografiaza('Poza cântarului', 0)
    await u.fotografiaza('Poza cântarului', 1)
    await u.fotografiaza('Poza ansamblului de pistoane')
    expect(T.executie_uscare_poze.size).toBe(3)
    expect(u.buton('Înregistrează etapa 1').disabled).toBe(false)
    ceas = ORA(8, 5)                                                              // apăsarea, 10:05 în România
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(T.executie_uscari.get(id)).toMatchObject({ ora_inceput: '2026-11-17T08:05:00.000Z', bureti_buc: 2,
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: null, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: null, motiv: null }] })
    expect(u.text()).toContain('Etapa 1 înregistrată la 10:05')
    expect(u.text()).toContain('Poți închide telefonul')
    // oprire: alt telefon / alt om (sesiune nouă, altă stocare locală), după 60 de minute
    ceas = ORA(9, 5)
    const v = await monteaza(client, stocareFalsa(), ex)
    expect(v.text()).toContain('Etapa 1 înregistrată · pistoanele introduse la 10:05')
    await v.apasa(v.buton('Continuă cu etapa 2'))
    expect(v.text()).toContain('Etapa 2 din 2')
    expect(v.buton('Termină etapa 2').disabled).toBe(true)
    await v.scrieEl(v.campuri('Greutatea pe cântar, la ieșire')[0], '1,40')
    await v.scrieEl(v.campuri('Greutatea pe cântar, la ieșire')[1], '1,35')
    expect(v.text()).toContain('+150 g')                                         // primul piston: informativ
    expect(v.text()).toContain('100 g/km × 1 km = 100 g')
    expect(v.text()).toContain('+50 g → ✓ în prag: propun USCAT')
    await v.fotografiaza('Poza cântarului', 0)
    await v.fotografiaza('Poza cântarului', 1)
    await v.fotografiaza('Poza ultimului piston')
    expect(v.text()).toContain('verdictul ultimului piston (uscat / umed)')
    await v.apasa(v.buton('USCAT (propus)'))
    expect(v.buton('Termină etapa 2').disabled).toBe(false)
    await v.apasa(v.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(id)).toMatchObject({ ora_final: '2026-11-17T09:05:00.000Z', piston_final_rezultat: 'uscat', concluzie: 'conform', timp_deplasare_min: 60 })
    // rezumat: durata, viteza, verdictul; „Generează raportul” inactiv până la detaliile obligatorii
    expect(v.text()).toContain('Rezumat')
    expect(v.text()).toContain('1 ore')
    expect(v.text()).toContain('0,28 m/s')                                        // 1000 m / 3600 s
    expect(v.buton('Generează raportul').disabled).toBe(true)
    for (const t of ['temperatura exterioară', 'utilajele (cel puțin unul)', 'presiunea în spatele buretelui', 'bifează că ai verificat']) expect(v.text()).toContain(t)
    await v.scrie('Temperatura exterioară (°C)', '8')
    await v.apasa(v.buton('+ Utilaj'))
    await v.scrie('Denumire 1', 'Compresor 12 bar')
    await v.scrie('PIG metalic [buc]', '0')
    await v.scrie('Piston poliuretan [buc]', '0')
    await v.scrie('Presiunea (bar)', '2,5')
    await v.scrie('Justificarea lipsei', 'manometru și termometru fără ecran lizibil')
    expect(v.buton('Generează raportul').disabled).toBe(true)                    // întâi salvarea
    await v.apasa(v.buton('Salvează detaliile'))
    await v.bifeaza('Am verificat detaliile')
    expect(v.buton('Generează raportul').disabled).toBe(false)
    await v.apasa(v.buton('Generează raportul'))
    expect(T.executie_uscari.get(id).stare).toBe('inchisa')
    expect(exporturi.at(-1)).toMatchObject({ id, cuCoordonate: false })
    expect(v.text()).toContain('Raport generat (închis)')
    expect(v.buton('Descarcă raportul (PDF)').disabled).toBe(false)
  })

  it('dublu click pe „Înregistrează etapa 1” = O SINGURĂ salvare (L05)', async () => {
    const { client, st, T } = clientFals()
    etapa1Gata(T, 1, { ora_inceput: null, cantariri: [{ nr: 1, intrare_kg: null, iesire_kg: null, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: null, motiv: null }] })
    st.auto = false
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(8) })
    await u.apasa(u.buton('Continuă cu etapa 1'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,2')
    await u.dublu(u.buton('Înregistrează etapa 1'))
    expect(salvari(st)).toHaveLength(1)
    await u.elibereaza(st.rpc[0], 'ok')
    expect(T.executie_uscari.get(1).versiune).toBe(2)
    expect(u.text()).toContain('Etapa 1 înregistrată')
  })

  it('L24: răspunsul „Înregistrează etapa 1” sosit după ce s-a deschis ALT raport nu schimbă ecranul celuilalt', async () => {
    const { client, st, T } = clientFals()
    etapa1Gata(T, 1, { tronson: 'Tr. A', ora_inceput: null })
    T.executie_uscari.set(2, RAP(2, { tronson: 'Tr. B', bureti_buc: 1, cantariri: [{ nr: 1, intrare_kg: null, iesire_kg: null, motiv: null }] }))
    st.auto = false
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(8) })
    await u.apasa(u.buton('Tronson Tr. A'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,26')
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(salvari(st)).toHaveLength(1)
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tronson Tr. B'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '2,5')
    await u.elibereaza(st.rpc[0], 'ok')                                          // serverul a aplicat cererea pentru A
    expect(T.executie_uscari.get(1).cantariri[0].intrare_kg).toBe(1.26)
    expect(u.text()).not.toContain('Etapa 1 înregistrată')                        // nicio confirmare pe B
    expect(u.text()).not.toContain('Înregistrarea etapei 1')
    expect(u.campuri('Greutatea pe cântar, la intrare')[0].value).toBe('2,5')    // formularul lui B neatins
    expect(u.text()).toContain('Tronson Tr. B')
  })

  it('ciorna locală: reîncărcarea paginii în mijlocul etapei 1 oferă restaurarea greutăților scrise', async () => {
    const { client, T } = clientFals()
    T.executie_uscari.set(1, RAP(1, { bureti_buc: 2, cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })) }))
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare, { ecranInitial: 'pasi', acum: () => ORA(8) })
    await u.apasa(u.buton('Continuă cu etapa 1'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[1], '1,31')
    const v = await monteaza(client, stocare, { ecranInitial: 'pasi', acum: () => ORA(8) })   // „reîncărcarea” (aceeași stocare)
    await v.apasa(v.buton('Continuă cu etapa 1'))
    expect(v.text()).toContain('Ai modificări nesalvate')
    expect(v.campuri('Greutatea pe cântar, la intrare')[1].disabled).toBe(true)  // până la alegere
    await v.apasa(v.buton('Restaurez'))
    expect(v.campuri('Greutatea pe cântar, la intrare')[1].value).toBe('1,31')
    expect(v.text()).toContain('Etapa 1 din 2')
  })

  it('pasul fiecărui raport din listă se deduce din date (etapa 1 / etapa 2 / raport / generat); eroarea pozelor nu e „etapa 1”', async () => {
    const { client, st, T } = clientFals()
    T.executie_uscari.set(1, RAP(1, { tronson: 'Tr. 1', bureti_buc: 2, cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })) }))
    etapa1Gata(T, 2, { tronson: 'Tr. 2' })
    etapa1Gata(T, 3, { tronson: 'Tr. 3', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'uscat',
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.32, motiv: null }] })
    pozaServer(T, 3, 'cantar_iesire', 1); pozaServer(T, 3, 'cantar_iesire', 2); pozaServer(T, 3, 'piston_final')
    T.executie_uscari.set(4, RAP(4, { tronson: 'Tr. 4', stare: 'inchisa', inchis_la: '2026-11-16T10:00:00Z', concluzie: 'conform' }))
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    const card = t => u.butoane().find(b => b.textContent.startsWith(`Tronson ${t}`)).textContent
    expect(card('Tr. 1')).toContain('Continuă cu etapa 1')
    expect(card('Tr. 2')).toContain('pistoanele introduse la 10:00')
    expect(card('Tr. 2')).toContain('Continuă cu etapa 2')
    expect(card('Tr. 3')).toContain('Generează raportul')
    expect(u.text()).toContain('Rapoarte generate')
    expect(u.butoane().some(b => b.textContent.startsWith('Tronson Tr. 4'))).toBe(false)   // generatul nu e „în lucru”
    await u.apasa(u.buton('Tronson Tr. 3'))
    expect(u.text()).toContain('Rezumat și raport')
    // eroarea de citire a pozelor (L18): pasul nu se ghicește
    st.eroareTabel = new Set(['executie_uscare_poze'])
    const v = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    expect(v.text()).toContain('Pasul nu s-a putut determina')
    expect(v.text()).not.toContain('Continuă cu etapa 1')
  })

  it('verdictul contrar calculului cere un motiv în observații; „Vezi / corectează toate datele” duce la formularul complet și înapoi', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1)
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2); pozaServer(T, 1, 'piston_final')
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    await u.apasa(u.buton('Continuă cu etapa 2'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,26')
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,45')        // +150 g > 100 g
    expect(u.text()).toContain('+150 g → ✗ peste prag: propun UMED')
    await u.apasa(u.buton('USCAT'))
    expect(u.text()).toContain('Ai ales altceva decât calculul (UMED)')
    expect(u.buton('Termină etapa 2').disabled).toBe(true)
    expect(u.text()).toContain('motivul (în observații) pentru verdictul diferit de calcul')
    await u.scrie('Ai ales altceva', 'apa din primul burete; ultimul cântărit cu buretele ud la exterior')
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: 'apa din primul burete; ultimul cântărit cu buretele ud la exterior' })
    await u.apasa(u.buton('Vezi / corectează toate datele'))
    expect(u.text()).toContain('1. Planificare și notificarea beneficiarului')
    await u.apasa(u.buton('Înapoi la pași'))
    expect(u.text()).toContain('Rezumat și raport')
  })

  it('ultimul piston UMED: „Trecere nouă” = raport nou pe același tronson, fără greutăți, cu numărul trecerii', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { proba_id: null, stare: 'inchisa', inchis_la: '2026-11-17T09:30:00Z', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'umed', concluzie: 'neconform',
      utilaje: [{ denumire: 'Compresor', buc: 1 }], cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.6, motiv: null }] })
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    await u.apasa(u.buton('Tr. test'))
    expect(u.text()).toContain('Conducta nu e încă uscată')
    await u.apasa(u.buton('Trecere nouă pe același tronson'))
    expect(u.text()).toContain('Pe ce tronson faci uscarea?')
    await u.apasa(u.buton('Începe'))
    const nou = [...T.executie_uscari.values()].find(r => r.id !== 1)
    expect(nou).toMatchObject({ tronson: 'Tr. test', km_de_la_m: 0, km_pana_la_m: 1000, lungime_m: 1000, bureti_buc: 2, utilaje: [{ denumire: 'Compresor', buc: 1 }],
      cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })) })
    expect(nou.observatii).toContain('Trecerea 2')
    expect(u.text()).toContain('Etapa 1 din 2')
  })
})
