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
// Runda 2: pdfSt.amana = { p } ține exportul „în zbor” (PDF-ul durează 5–15 s pe telefon) până la eliberarea manuală.
const pdfSt = vi.hoisted(() => ({ real: false, salvari: [], amana: null }))
vi.mock('./uscarePdf.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, exportRaportUscarePDF: async a => {
    if (pdfSt.real) return real.exportRaportUscarePDF(a)
    exporturi.push({ id: a.uscare.id, cuCoordonate: a.cuCoordonate })
    if (pdfSt.amana) await pdfSt.amana.p
    return { necitite: 0 }
  } }
})
vi.mock('jspdf', () => ({ default: class { setProperties() {} addPage() {} addImage() {} getNumberOfPages() { return 1 } save(n) { pdfSt.salvari.push(n) } } }))
vi.mock('html2canvas', () => ({ default: async () => ({ width: 1476, height: 300, toDataURL: () => 'data:image/jpeg;base64,AA==' }) }))
import UscareConducta from './UscareConducta.jsx'
import { lipsaDinRand, incarcariDeschise } from './uscareLogica.js'
import { formularPasNou } from './uscarePasi.js'   // doar ca FIXTURĂ (ciorna identică cu formularul propus), nu ca valoare așteptată
// runda 3: textele cu care motivul verdictului și „trecerea nouă” ajung în observații, scrise aici de mână (L25), nu luate din uscarePasi.js
const PREFIX_MOTIV_VERDICT = 'Verdictul diferit de calcul, motivul:'
const textTrecere = (n, zi) => `Trecerea ${n} pe acest tronson (trecerea anterioară: raportul din ${zi}, ultimul piston nu a ieșit uscat).`
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
// profiles: numele colegilor (runda 2: cardul „Continuă cu etapa 2” spune cine a salvat ultima dată); `uid` = contul clientului întors
function clientFals({ rapoarte = [], incarcari = [], sites = [], meteo = [], profiles = [], uid = 'u1' } = {}) {
  const T = {
    executie_uscari: new Map(rapoarte.map(r => [r.id, { ...r }])), executie_uscare_jurnal: new Map(),
    executie_uscare_incarcari: new Map(incarcari.map(i => [i.id, { ...i }])), executie_uscare_poze: new Map(),
    sites: new Map(sites.map(s => [s.id, { ...s }])), meteo_cache: new Map(meteo.map(m => [m.site_id, { id: m.site_id, ...m }])),
    profiles: new Map(profiles.map(p => [p.id, { ...p }])),
    fisiere: new Set(),
  }
  // st.amanaTabel: tabelele ale căror citiri așteaptă eliberarea manuală (st.cereriTabel) — răspunsuri „în zbor”
  const st = { rpc: [], auto: true, amanaTabel: new Set(), cereriTabel: [], retrageEroare: false }
  let idNou = 100
  const interogare = tabel => {
    const f = { eq: [], in: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q, in: (c, v) => { f.in.push([c, v]); return q },
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        if (st.eroareTabel?.has(tabel)) return Promise.resolve({ data: null, error: { message: 'eroare simulată' } }).then(res, rej)
        const calc = () => ({ data: [...(T[tabel] || new Map()).values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && f.in.every(([c, v]) => v.includes(r[c])) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, f.lim).map(r => ({ ...r })), error: null })
        if (st.amanaTabel.has(tabel)) { const d = amana(); st.cereriTabel.push({ tabel, ...d }); return d.p.then(calc).then(res, rej) }
        return Promise.resolve(calc()).then(res, rej)
      },
    }
    return q
  }
  // cont = contul care a trimis cererea (runda 2: doi colegi pe același raport); serverul pune creat_de / modificat_de ca trigger-ul real
  const jurnal = (cheie, uscare_id, actiune, cont) => T.executie_uscare_jurnal.set(++idNou, { id: idNou, cheie, uscare_id, actiune, proiect_id: 1, creat_de: cont })
  // serverul FALS: cheia apăsării (duplicat; retrasă = refuz), CAS pe versiune (conflict cu rândul curent), creare, poza din rezervare, retragerea
  const aplica = (fn, a, cont = uid) => {
    const j = [...T.executie_uscare_jurnal.values()].find(x => x.cheie === a.p_cheie)
    if (fn === 'fn_executie_uscare_retrage') {
      if (j) return j.actiune === 'cheie_retrasa' ? { ok: true, duplicat: true, aplicat: false, retrasa: true } : { ok: true, duplicat: true, aplicat: true, retrasa: false, actiune: j.actiune, uscare_id: j.uscare_id }
      jurnal(a.p_cheie, null, 'cheie_retrasa', cont)
      return { ok: true, duplicat: false, aplicat: false, retrasa: true }
    }
    if (j?.actiune === 'cheie_retrasa') return { __eroare: { code: '22023', message: 'uscare: cererea a fost retrasă (Renunț) și nu se mai aplică' } }
    if (j) return { ok: true, duplicat: true, uscare: { ...T.executie_uscari.get(j.uscare_id) } }
    if (fn === 'fn_executie_uscare_poza' && a.p_actiune === 'adauga') {
      const i = [...T.executie_uscare_incarcari.values()].find(x => x.cale === a.p_cale && x.uscare_id === a.p_uscare && !x.renuntat_la)
      if (!i || !T.fisiere.has(a.p_cale)) return { __eroare: { code: '22023', message: 'uscare: fișierul pozei nu e încărcat' } }
      const p = { id: ++idNou, uscare_id: i.uscare_id, proiect_id: 1, categorie: i.categorie, burete_nr: i.burete_nr, cale: i.cale, legenda: i.legenda, creat_la: '2026-11-10T09:00:00Z' }
      T.executie_uscare_poze.set(p.id, p); jurnal(a.p_cheie, i.uscare_id, 'poza_adaugata', cont)
      return { ok: true, duplicat: false, poza: { ...p } }
    }
    // pașii (runda „ecran pe pași”): rezervarea căii pozei și tranziția de stare, ca serverul (închiderea cere lipsaDinRand gol)
    if (fn === 'fn_executie_uscare_poza' && a.p_actiune === 'rezerva') {
      const i = { id: ++idNou, uscare_id: a.p_uscare, proiect_id: 1, cale: a.p_cale, categorie: a.p_categorie, burete_nr: a.p_burete_nr, legenda: null,
        renuntat_motiv: null, renuntat_la: null, creat_la: '2026-11-17T08:00:00Z' }
      T.executie_uscare_incarcari.set(i.id, i); jurnal(a.p_cheie, a.p_uscare, 'rezervare', cont)
      return { ok: true, duplicat: false, incarcare: { ...i } }
    }
    if (fn === 'fn_executie_uscare_stare') {
      const r = T.executie_uscari.get(a.p_id)
      if (r.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', uscare: { ...r } }
      const pz = [...T.executie_uscare_poze.values()].filter(p => p.uscare_id === r.id)
      const inc = [...T.executie_uscare_incarcari.values()].filter(i => i.uscare_id === r.id)
      if (a.p_actiune === 'inchide' && lipsaDinRand(r, pz, incarcariDeschise(inc, pz).length).length) return { __eroare: { code: '22023', message: 'uscare: raportul nu e complet' } }
      Object.assign(r, { stare: { inchide: 'inchisa', anuleaza: 'anulata', redeschide: 'deschisa' }[a.p_actiune], inchis_la: a.p_actiune === 'inchide' ? '2026-11-17T09:30:00Z' : null, versiune: r.versiune + 1 })
      jurnal(a.p_cheie, r.id, a.p_actiune, cont)
      return { ok: true, duplicat: false, uscare: { ...r } }
    }
    if (fn !== 'fn_executie_uscare_salveaza') throw new Error('rpc necunoscut ' + fn + ' ' + a.p_actiune)
    if (a.p_id == null) {
      const r = RAP(++idNou, { ...a.p_date, versiune: 1, creat_de: cont, modificat_de: cont })
      T.executie_uscari.set(r.id, r)
      jurnal(a.p_cheie, r.id, 'creare', cont)
      return { ok: true, duplicat: false, uscare: { ...r } }
    }
    const r = T.executie_uscari.get(a.p_id)
    if (r.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', uscare: { ...r } }
    Object.assign(r, a.p_date, { versiune: r.versiune + 1, modificat_de: cont }, st.ceas ? { modificat_la: new Date(st.ceas()).toISOString() } : {})
    jurnal(a.p_cheie, r.id, 'salvare', cont)
    return { ok: true, duplicat: false, uscare: { ...r } }
  }
  const raspuns = x => (x?.__eroare ? { data: null, error: x.__eroare } : { data: x, error: null })
  // clientul unui cont (runda 2: `altCont('u2')` = alt coleg, pe ACELAȘI server fals și același jurnal de cereri)
  const faClient = cont => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: cont } } }, error: null }) },
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
      // st.refuzaSalvari = n: următoarele n salvări sunt REFUZATE determinist de server (nimic scris), ca o regulă a serverului
      if (fn === 'fn_executie_uscare_salveaza' && st.refuzaSalvari > 0) { st.refuzaSalvari -= 1; return Promise.resolve({ data: null, error: { code: '22023', message: 'uscare: refuz simulat' } }) }
      const d = amana(); st.rpc.push({ fn, a, ...d })
      // st.devreme: serverul scrie LA APEL, dar răspunsul se pierde (timeout) la eliberarea cu „eroare”
      const devreme = st.devreme ? aplica(fn, a, cont) : null
      if (st.auto) d.res('ok')
      return d.p.then(mod => (mod === 'eroare' ? { data: null, error: { message: 'timeout simulat' } } : raspuns(devreme || aplica(fn, a, cont))))
    },
  })
  const client = faClient(uid)
  // o cerere pierdută care ajunge la server MAI TÂRZIU (după „Renunț”): direct la serverul fals
  const ajungeTarziu = (fn, a) => raspuns(aplica(fn, a))
  return { client, st, T, ajungeTarziu, altCont: faClient }
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

  // review #1129 pct. 4: valorile tastate încă INVALIDE / incomplete (nu trec de validare, deci nu intră în payload) se păstrează în ciornă
  const ciorne = s => [...s.m.keys()].filter(k => k.includes('.ciorna.'))
  it('#1129-4 raport NOU: lungimea cu 2 zecimale (500.12) intră în ciornă, ieșirea întreabă, redeschiderea o oferă și o restaurează', async () => {
    const { client } = clientFals()
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    let intrebari = 0
    u.j.window.confirm = () => { intrebari += 1; return true }
    await u.apasa(u.buton('Alt interval / tot traseul'))
    expect(ciorne(stocare)).toEqual([])                                  // neatins: nimic scris
    await u.scrie('Lungime (m)', '500.12')
    expect(ciorne(stocare)).toHaveLength(1)
    expect(JSON.parse(stocare.getItem(ciorne(stocare)[0])).form.lungime_m).toBe('500.12')
    await u.apasa(u.buton('← Lista'))
    expect(intrebari).toBe(1)
    await u.apasa(u.buton('Alt interval / tot traseul'))
    expect(u.text()).toContain('Ai modificări nesalvate')                // oferită, nu aruncată la deschidere
    expect(ciorne(stocare)).toHaveLength(1)
    await u.apasa(u.buton('Restaurez'))
    expect(u.camp('Lungime (m)').value).toBe('500.12')
  })
  it('#1129-4 raport NOU: un utilaj numit cu bucățile încă goale nu se pierde (scris, apoi oferit la redeschidere)', async () => {
    const { client } = clientFals()
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('Alt interval / tot traseul'))
    await u.scrie('Denumire 1', 'Compresor')
    await u.scrie('Buc.', '')
    const c = JSON.parse(stocare.getItem(ciorne(stocare)[0]))
    expect(c.form.utilaje).toEqual([{ denumire: 'Compresor', buc: '' }])
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Alt interval / tot traseul'))
    expect(u.text()).toContain('Ai modificări nesalvate')
    await u.apasa(u.buton('Restaurez'))
    expect(u.camp('Denumire 1').value).toBe('Compresor')
    expect(u.camp('Buc.').value).toBe('')
  })
  // (ciorna identică cu formularul propus se aruncă în continuare: testul „17.11.2026: Uscare nouă neatinsă…” de la pași, neschimbat)
  it('#1129-4 raport SALVAT: text într-un câmp numeric gol intră în ciornă și se oferă la redeschidere', async () => {
    const { client } = clientFals({ rapoarte: [RAP(1)] })                // presiunea goală pe server: payload-ul invalid (null) = același
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('Tr. test'))
    expect(ciorne(stocare)).toEqual([])
    await u.scrie('Presiunea în spatele buretelui (bar)', '1,5 bar')
    expect(ciorne(stocare)).toHaveLength(1)
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tr. test'))
    expect(u.text()).toContain('Ai modificări nesalvate')
    await u.apasa(u.buton('Restaurez'))
    expect(u.camp('Presiunea în spatele buretelui (bar)').value).toBe('1,5 bar')
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
    // Tr. 5 = Tr. 3 + concluzia pusă de „Termină etapa 2” (17.11.2026: datele etapei 2 fără concluzie NU sunt „etapa 2 terminată”)
    etapa1Gata(T, 5, { tronson: 'Tr. 5', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'uscat', concluzie: 'conform',
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.32, motiv: null }] })
    pozaServer(T, 5, 'cantar_iesire', 1); pozaServer(T, 5, 'cantar_iesire', 2); pozaServer(T, 5, 'piston_final')
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    const card = t => u.butoane().find(b => b.textContent.startsWith(`Tronson ${t}`)).textContent
    expect(card('Tr. 1')).toContain('Continuă cu etapa 1')
    expect(card('Tr. 2')).toContain('pistoanele introduse la 10:00')
    expect(card('Tr. 2')).toContain('Continuă cu etapa 2')
    expect(card('Tr. 3')).toContain('Continuă cu etapa 2')
    expect(card('Tr. 5')).toContain('Generează raportul')
    expect(u.text()).toContain('Rapoarte generate')
    expect(u.butoane().some(b => b.textContent.startsWith('Tronson Tr. 4'))).toBe(false)   // generatul nu e „în lucru”
    await u.apasa(u.buton('Tronson Tr. 5'))
    expect(u.text()).toContain('Rezumat și raport')
    // eroarea de citire a pozelor (L18): pasul nu se ghicește
    st.eroareTabel = new Set(['executie_uscare_poze'])
    const v = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    expect(v.text()).toContain('Pasul nu s-a putut determina')
    expect(v.text()).not.toContain('Continuă cu etapa 1')
  })

  it('verdictul contrar calculului cere un motiv scris (câmp distinct, pus apoi în observații); „Vezi / corectează toate datele” duce la formularul complet și înapoi', async () => {
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
    expect(u.text()).toContain('motivul scris de tine pentru verdictul diferit de calcul')
    await u.scrie('Ai ales altceva', 'apa din primul burete; ultimul cântărit cu buretele ud la exterior')
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: `${PREFIX_MOTIV_VERDICT} apa din primul burete; ultimul cântărit cu buretele ud la exterior` })
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

  // ── runda 2: aducerea la zi cu reparațiile de după proba pe telefon (#1126) + ce a arătat proba ──
  // Zona plutitoarelor: aceleași cifre ca în testele formularului complet (din sursele butoanelor platformei, nu din ecranul testat).
  const ZONA = 106
  const px = v => parseFloat(String(v).replace('px', ''))
  const baraFixa = btn => { let b = btn.parentElement; while (b && b.style.position !== 'fixed') b = b.parentElement; return b }
  const josFormular = u => { const f = u.d.getElementById('r').firstElementChild; return px(f.style.paddingBottom || f.style.padding.split(' ')[2]) }
  // bara pașilor: butonul mare 60 + padding 2×10 + chenar; cu „Salvează pe parcurs” (48) + spațiul (6) când formularul are modificări
  const verificaBara = (u, btn, inaltimeMin) => {
    const bara = baraFixa(btn)
    expect(bara, 'bara fixă a butonului ' + btn.textContent).toBeTruthy()
    expect(px(bara.style.bottom), 'deasupra plutitoarelor: ' + btn.textContent).toBeGreaterThanOrEqual(ZONA)
    expect([bara.style.left, bara.style.right]).toEqual(['0px', '0px'])
    expect(josFormular(u), 'rezerva de jos a formularului: ' + btn.textContent).toBeGreaterThanOrEqual(px(bara.style.bottom) + inaltimeMin)
  }
  it('runda 2: butoanele fixe ale pașilor (tronson, etapa 1, etapa 2, raport, PDF-ul raportului închis) stau deasupra butoanelor plutitoare; ultimul câmp nu rămâne sub ele', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 2, { tronson: 'Tr. e2' })
    T.executie_uscari.set(3, RAP(3, { tronson: 'Tr. gata', stare: 'inchisa', inchis_la: '2026-11-16T10:00:00Z', concluzie: 'conform' }))
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(8) })
    await u.apasa(u.buton('Uscare nouă'))
    verificaBara(u, u.buton('Începe'), 60 + 20 + 1)
    await u.scrie('Tronson (cum apare în raport)', 'Tr. nou'); await u.scrie('De la km', '0+000'); await u.scrie('La km', '0+500')
    await u.apasa(u.buton('Începe'))
    verificaBara(u, u.buton('Înregistrează etapa 1'), 60 + 20 + 1)
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,2')        // modificări -> și „Salvează pe parcurs” în bară
    verificaBara(u, u.buton('Înregistrează etapa 1'), 60 + 6 + 48 + 20 + 1)
    expect(baraFixa(u.buton('Salvează pe parcurs'))).toBe(baraFixa(u.buton('Înregistrează etapa 1')))
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tronson Tr. e2'))
    verificaBara(u, u.buton('Termină etapa 2'), 60 + 20 + 1)
    await u.apasa(u.buton('← Lista'))
    await u.apasa(u.buton('Tr. gata'))
    verificaBara(u, u.buton('Descarcă raportul (PDF)'), 60 + 20 + 1)
  })

  it('runda 2: „scoate poza” și bifa „coordonatele în PDF” au ținte de atingere de cel puțin 44 px', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { ora_inceput: null })                                      // etapa 1 încă deschisă: pozele cântarelor de la intrare sunt pe ecran
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    await u.apasa(u.buton('Continuă cu etapa 1'))
    const x = u.d.querySelector('[aria-label="Scoate poza"]')
    expect(x, 'butonul de scos poza (etapa 1 arată pozele cântarelor)').toBeTruthy()
    expect(px(x.style.width)).toBeGreaterThanOrEqual(44)
    expect(px(x.style.height)).toBeGreaterThanOrEqual(44)
    await u.apasa(u.buton('Vezi / corectează toate datele'))
    const et = [...u.d.querySelectorAll('label')].find(l => l.textContent.includes('coordonatele exacte'))
    expect(et, 'eticheta bifei (toată e apăsabilă)').toBeTruthy()
    expect(px(et.style.minHeight)).toBeGreaterThanOrEqual(44)
    expect(px(et.querySelector('input').style.width)).toBeGreaterThanOrEqual(24)
  })

  it('runda 2: cât se generează PDF-ul, butonul spune „Se generează raportul…” și a doua apăsare NU pornește alt export (L05) — pe pași, pe raportul închis și pe formularul complet', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { tronson: 'Tr. închis', stare: 'inchisa', inchis_la: '2026-11-17T09:30:00Z', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'uscat', concluzie: 'conform',
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.32, motiv: null }] })
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    await u.apasa(u.buton('Tr. închis'))
    const n0 = exporturi.length
    pdfSt.amana = amana()
    try {
      const b = u.buton('Descarcă raportul (PDF)')
      expect(b.disabled).toBe(false)
      await u.dublu(b)                                                            // două apăsări în același tact
      expect(exporturi.length).toBe(n0 + 1)
      expect(u.buton('Se generează raportul').disabled).toBe(true)
      expect(u.text()).toContain('poate dura 5–15 secunde')
      await u.apasa(u.buton('Se generează raportul'))                             // a treia, cât e în zbor
      expect(exporturi.length).toBe(n0 + 1)
      await u.elibereaza(pdfSt.amana, true)
      expect(u.text()).toContain('PDF generat.')
      expect(u.buton('Descarcă raportul (PDF)').disabled).toBe(false)
      // formularul complet, același raport
      await u.apasa(u.buton('Vezi / corectează toate datele'))
      pdfSt.amana = amana()
      await u.dublu(u.buton('Raportul în PDF'))
      expect(exporturi.length).toBe(n0 + 2)
      expect(u.buton('Se generează raportul').disabled).toBe(true)
      await u.elibereaza(pdfSt.amana, true)
      expect(u.buton('Raportul în PDF').disabled).toBe(false)
    } finally { pdfSt.amana = null }
  })

  it('runda 2: după o salvare FĂRĂ utilaje rămâne un rând gol de utilaj (pe pași și pe formularul complet); rândul gol nu se trimite', async () => {
    const { client, st, T } = clientFals()
    etapa1Gata(T, 1, { ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'uscat', concluzie: 'conform', utilaje: [],
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.32, motiv: null }] })
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2); pozaServer(T, 1, 'piston_final')
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    await u.apasa(u.buton('Tr. test'))
    expect(u.text()).toContain('Rezumat și raport')
    expect(u.campuri('Denumire 1'), 'rândul gol pe rezumat').toHaveLength(1)
    await u.scrie('Temperatura exterioară (°C)', '7')
    await u.apasa(u.buton('Salvează detaliile'))                                 // salvare fără utilaje
    expect(salvari(st).at(-1).a.p_date.utilaje).toEqual([])
    expect(u.campuri('Denumire 1'), 'după salvare, rândul gol rămâne').toHaveLength(1)
    expect(u.buton('+ Utilaj')).toBeTruthy()
    await u.scrie('Denumire 1', 'Compresor')
    await u.apasa(u.buton('Salvează detaliile'))
    expect(salvari(st).at(-1).a.p_date.utilaje).toEqual([{ denumire: 'Compresor', buc: 1 }])
    // formularul complet: la fel
    await u.apasa(u.d.querySelector('[aria-label="Scoate utilajul"]'))
    await u.apasa(u.buton('Salvează detaliile'))
    expect(salvari(st).at(-1).a.p_date.utilaje).toEqual([])
    await u.apasa(u.buton('Vezi / corectează toate datele'))
    expect(u.campuri('Denumire 1'), 'rândul gol pe formularul complet').toHaveLength(1)
  })

  it('runda 2: etapa 2 o face ALT cont: cardul „Continuă cu etapa 2” e vizibil oricui are drept pe proiect, cu ora etapei 1 și cine a salvat-o', async () => {
    const profiles = [{ id: 'u1', name: 'POPESCU ION' }, { id: 'u2', name: 'IONESCU VASILE' }]
    const { client, st, T, altCont } = clientFals({ profiles })
    let ceas = ORA(8)
    st.ceas = () => ceas
    const ex = { ecranInitial: 'pasi', acum: () => ceas }
    // contul u1 (capătul de introducere) face etapa 1
    const u = await monteaza(client, stocareFalsa(), ex)
    await u.apasa(u.buton('Uscare nouă'))
    await u.scrie('Tronson (cum apare în raport)', 'Tr. doi'); await u.scrie('De la km', '0+000'); await u.scrie('La km', '1+000')
    await u.apasa(u.buton('Începe'))
    const id = [...T.executie_uscari.keys()][0]
    T.executie_uscari.get(id).cantariri = [{ nr: 1, intrare_kg: 1.25, iesire_kg: null, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: null, motiv: null }]
    pozaServer(T, id, 'cantar_intrare', 1); pozaServer(T, id, 'cantar_intrare', 2); pozaServer(T, id, 'pistoane')
    await u.apasa(u.buton('← Lista')); await u.apasa(u.buton('Tronson Tr. doi'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,25'); await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[1], '1,30')
    ceas = ORA(8, 5)
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(T.executie_uscari.get(id)).toMatchObject({ modificat_de: 'u1', ora_inceput: '2026-11-17T08:05:00.000Z' })
    await u.apasa(u.buton('← Lista'))
    expect(u.buton('Tronson Tr. doi').textContent).toContain('de tine')          // propriul cont
    // contul u2 (capătul de ieșire), alt telefon, altă stocare locală, 50 de minute mai târziu
    ceas = ORA(8, 55)
    const v = await monteaza(altCont('u2'), stocareFalsa(), ex)
    const card = v.buton('Tronson Tr. doi').textContent
    expect(card).toContain('Continuă cu etapa 2')
    expect(card).toContain('pistoanele introduse la 10:05')
    expect(card).toContain('Salvat ultima dată 17.11.2026 10:05 de POPESCU ION')
    await v.apasa(v.buton('Continuă cu etapa 2'))
    expect(v.text()).toContain('Etapa 2 din 2')
    await v.scrieEl(v.campuri('Greutatea pe cântar, la ieșire')[0], '1,30'); await v.scrieEl(v.campuri('Greutatea pe cântar, la ieșire')[1], '1,33')
    await v.apasa(v.buton('Salvează pe parcurs'))                                  // greutățile ajung pe server de la u2
    pozaServer(T, id, 'cantar_iesire', 1); pozaServer(T, id, 'cantar_iesire', 2); pozaServer(T, id, 'piston_final')
    await v.apasa(v.buton('← Lista'))
    expect(v.buton('Tronson Tr. doi').textContent).toContain('de tine')          // acum ultima salvare e a lui u2
    await v.apasa(v.buton('Tronson Tr. doi'))
    await v.apasa(v.buton('USCAT (propus)'))
    await v.apasa(v.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(id)).toMatchObject({ modificat_de: 'u2', creat_de: 'u1', piston_final_rezultat: 'uscat', ora_final: '2026-11-17T08:55:00.000Z' })
    expect([...T.executie_uscare_jurnal.values()].filter(j => j.actiune === 'salvare').map(j => j.creat_de)).toEqual(['u1', 'u2', 'u2'])
    // u1 vede, din listă, că u2 a dus raportul la rezumat
    const u1 = await monteaza(client, stocareFalsa(), ex)
    expect(u1.buton('Tronson Tr. doi').textContent).toContain('Generează raportul')
    expect(u1.buton('Tronson Tr. doi').textContent).toContain('de IONESCU VASILE')
    // eroarea de citire a numelor nu devine „fără nume” (L18): u1 vede salvarea lui u2 fără nume, cu motivul
    st.eroareTabel = new Set(['profiles'])
    const w = await monteaza(client, stocareFalsa(), ex)
    expect(w.buton('Tronson Tr. doi').textContent).toContain('de un coleg (numele nu s-a putut citi)')
  })

  it('runda 2 (decizia E): pistonul ieșit mai ușor cu peste 1% nu primește propunere; diferența negativă e scrisă explicit', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    await u.apasa(u.buton('Continuă cu etapa 2'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,23')          // 1.300 g -> 1.230 g = mai ușor cu 70 g (> 1% = 13 g)
    expect(u.text()).toContain('mai ușor cu 70 g → ⚠ verifică cântărirea (nu propun nimic)')
    expect(u.text()).toContain('a ieșit cu 70 g mai ușor (peste 1% din greutate): verifică cântărirea')
    expect(u.text()).not.toContain('(propus)')
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,29')          // mai ușor cu 10 g (≤ 1%): fără acumulare -> uscat
    expect(u.text()).toContain('mai ușor cu 10 g → ✓ în prag: propun USCAT')
  })

  // runda 3: drumul prin Execuție (banda, sub-filele, URL-ul) se probează prin NAVIGARE reală în src/Executie.test.jsx, nu pe textul sursei.

  // ── runda 3 (verdict Jakarinos NO-GO pe 52dec722): o singură regulă decide dacă raportul se poate genera (lipsaDinRand) ──
  // rândul COMPLET pentru regula comună (toate detaliile cerute de închidere), 2 pistoane, ultimul +300 g (peste prag → UMED / NECONFORM)
  const completServer = (T, id, extra = {}) => T.executie_uscari.set(id, RAP(id, { tronson: `Tr. ${id}`, data_operatie: '2026-11-17', temperatura_c: 8, utilaje: [{ denumire: 'Compresor', buc: 1 }],
    ora_inceput: '2026-11-17T08:00:00Z', ora_final: '2026-11-17T09:00:00Z', pig_metalic_buc: 0, piston_pu_buc: 0, bureti_buc: 2,
    cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.4, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.6, motiv: null }], presiune_bar: 2.5, timp_deplasare_min: 60,
    piston_final_rezultat: 'umed', concluzie: 'neconform', ...extra }))
  // lista „mai trebuie:” a etapei (blocul Lipsuri), ca text pe rânduri (blocul „Nu poți face o poză?” enumeră și el pozele, informativ)
  const lipsuri = u => [...u.d.querySelectorAll('[role="status"] li')].map(li => li.textContent)
  it('runda 3 (P1): rapoartele pe care regula comună le permite ajung la REZUMAT pe pași: NECONFORM cu pozele justificate, NECONFORM fără poza ultimului piston, zero bureți; și după redeschidere', async () => {
    const { client, T } = clientFals()
    completServer(T, 1, { poze_justificare: 'aparatul foto defect; cântarul citit de doi martori' })        // (a) completat la birou, în formularul complet
    completServer(T, 2)                                                                                      // (b) toate pozele cerute, fără poza ultimului piston
    for (const [c, n] of [['manometru'], ['temperatura'], ['pistoane'], ['cantar_intrare', 1], ['cantar_intrare', 2], ['cantar_iesire', 1], ['cantar_iesire', 2]]) pozaServer(T, 2, c, n ?? null)
    completServer(T, 3, { bureti_buc: 0, cantariri: [], poze_justificare: 'fără pistoane-burete, doar PIG metalic' })   // (c) zero bureți
    for (const id of [1, 2, 3]) expect(lipsaDinRand(T.executie_uscari.get(id), [...T.executie_uscare_poze.values()].filter(p => p.uscare_id === id))).toEqual([])
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    for (const id of [1, 2, 3]) expect(u.buton(`Tronson Tr. ${id}`).textContent, `cardul ${id}`).toContain('Generează raportul →')
    // (a): rezumatul, „Generează raportul” accesibil după bifă; închiderea reușește (serverul fals aplică lipsaDinRand), apoi PDF-ul
    await u.apasa(u.buton('Tronson Tr. 1'))
    expect(u.text()).toContain('Rezumat și raport')
    expect(u.text()).not.toContain('Etapa 1 din 2')
    expect(u.text()).toContain('NU IESE USCAT')
    await u.bifeaza('Am verificat detaliile')
    expect(u.buton('Generează raportul').disabled).toBe(false)
    await u.apasa(u.buton('Generează raportul'))
    expect(T.executie_uscari.get(1).stare).toBe('inchisa')
    expect(exporturi.at(-1)).toMatchObject({ id: 1 })
    expect(u.text()).toContain('Raport generat (închis)')
    await u.apasa(u.buton('← Lista'))
    // (b) și (c): la fel
    for (const id of [2, 3]) {
      await u.apasa(u.buton(`Tronson Tr. ${id}`))
      expect(u.text(), `raportul ${id}`).toContain('Rezumat și raport')
      await u.bifeaza('Am verificat detaliile')
      expect(u.buton('Generează raportul').disabled, `raportul ${id}`).toBe(false)
      await u.apasa(u.buton('← Lista'))
    }
    // redeschiderea consemnată (administrator) pune raportul (a) înapoi pe „deschis”: pasul se recalculează din date → tot rezumatul, nu etapa 1
    Object.assign(T.executie_uscari.get(1), { stare: 'deschisa', inchis_la: null, revizie: 1, versiune: 7 })
    const v = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(11) })
    expect(v.buton('Tronson Tr. 1').textContent).toContain('Generează raportul →')
    await v.apasa(v.buton('Tronson Tr. 1'))
    expect(v.text()).toContain('Rezumat și raport')
    await v.bifeaza('Am verificat detaliile')
    expect(v.buton('Generează raportul').disabled).toBe(false)
  })

  it('runda 3 (P1): raport început în formularul complet (birou, cu justificarea pozelor) și continuat pe pași: etapele cer doar ce lipsește; USCAT cere dovada, UMED contra calculului cere motivul scris', async () => {
    const { client, T } = clientFals()
    T.executie_uscari.set(1, RAP(1, { data_operatie: '2026-11-17', temperatura_c: 8, utilaje: [{ denumire: 'Compresor', buc: 1 }], pig_metalic_buc: 0, piston_pu_buc: 0, bureti_buc: 2,
      cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })), presiune_bar: 2.5, poze_justificare: 'cântarul nu are ecran lizibil' }))
    let ceas = ORA(8)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ceas })
    expect(u.buton('Tronson Tr. test').textContent).toContain('Continuă cu etapa 1')
    await u.apasa(u.buton('Continuă cu etapa 1'))
    expect(u.text()).toContain('Nu poți face o poză?')
    expect(u.camp('Justificarea lipsei pozelor').value).toBe('cântarul nu are ecran lizibil')
    expect(lipsuri(u)).toEqual(['greutatea pistonului 1 la intrare', 'greutatea pistonului 2 la intrare'])   // pozele justificate NU sunt cerute
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,25'); await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[1], '1,30')
    expect(lipsuri(u)).toEqual([])
    expect(u.buton('Înregistrează etapa 1').disabled).toBe(false)
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(u.text()).toContain('Etapa 1 înregistrată')
    await u.apasa(u.buton('Continuă acum cu etapa 2'))
    ceas = ORA(9)
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,40'); await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,35')
    expect(u.text()).toContain('propun USCAT')
    await u.apasa(u.buton('USCAT (propus)'))
    expect(u.buton('Termină etapa 2').disabled).toBe(true)
    expect(lipsuri(u)).toEqual(['poza ultimului piston (dovada că iese uscat)'])                             // dovada nu se justifică; pozele cântarelor, da
    await u.apasa(u.buton('UMED'))                                                                            // contra calculului → motivul scris de om
    expect(u.buton('Termină etapa 2').disabled).toBe(true)
    expect(lipsuri(u)).toEqual(['motivul scris de tine pentru verdictul diferit de calcul'])
    await u.scrie('Ai ales altceva decât calculul (USCAT)', 'buretele ud la exterior')
    expect(lipsuri(u)).toEqual([])
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'umed', concluzie: 'neconform', observatii: `${PREFIX_MOTIV_VERDICT} buretele ud la exterior` })
    expect(u.text()).toContain('Rezumat și raport')
    await u.bifeaza('Am verificat detaliile')
    expect(u.buton('Generează raportul').disabled).toBe(false)
  })

  it('runda 3 (P1): pe telefon, fără poze: etapa 1 le cere, iar ieșirea e „nu pot face o poză — scriu de ce” (aceeași justificare ca în formularul complet, salvată cu raportul)', async () => {
    const { client, T } = clientFals()
    T.executie_uscari.set(1, RAP(1, { bureti_buc: 1, cantariri: [{ nr: 1, intrare_kg: null, iesire_kg: null, motiv: null }] }))
    let ceas = ORA(8)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ceas, comprima: async () => new Blob(['x']) })
    await u.apasa(u.buton('Continuă cu etapa 1'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,25')
    expect(u.buton('Înregistrează etapa 1').disabled).toBe(true)
    expect(lipsuri(u)).toEqual(['poza cântarului pentru pistonul 1 (intrare)', 'poza ansamblului de pistoane'])
    expect(u.text()).toContain('Nu poți face o poză?')
    await u.scrie('Justificarea lipsei pozelor', 'camera telefonului defectă')
    expect(u.text()).not.toContain('Ca să înregistrezi etapa 1, mai trebuie')
    expect(lipsuri(u)).toEqual([])
    expect(u.buton('Înregistrează etapa 1').disabled).toBe(false)
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(T.executie_uscari.get(1)).toMatchObject({ poze_justificare: 'camera telefonului defectă', cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: null, motiv: null }] })
    // etapa 2: pozele cântarului sunt justificate (blocul rămâne, cu textul salvat); dovada USCAT tot se cere (nu se justifică)
    await u.apasa(u.buton('Continuă acum cu etapa 2'))
    ceas = ORA(9)
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,30')
    await u.apasa(u.buton('USCAT (propus)'))
    expect(u.text()).toContain('Ca să termini etapa 2, mai trebuie:')
    expect(lipsuri(u)).toEqual(['poza ultimului piston (dovada că iese uscat)'])
    expect(u.camp('Justificarea lipsei pozelor').value).toBe('camera telefonului defectă')
    await u.fotografiaza('Poza ultimului piston')
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
  })

  it('runda 3 (P2-4): la „Trecere nouă”, textul automat din observații NU motivează verdictul contrar: motivul e câmp distinct, scris de om, apoi adăugat la observații', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { stare: 'inchisa', inchis_la: '2026-11-17T09:30:00Z', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'umed', concluzie: 'neconform',
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.6, motiv: null }] })
    let ceas = ORA(10)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ceas, comprima: async () => new Blob(['x']) })
    await u.apasa(u.buton('Tr. test'))
    await u.apasa(u.buton('Trecere nouă pe același tronson'))
    await u.apasa(u.buton('Începe'))
    const nou = [...T.executie_uscari.values()].find(r => r.id !== 1)
    expect(nou.observatii).toBe(textTrecere(2, '17.11.2026'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[0], '1,25'); await u.scrieEl(u.campuri('Greutatea pe cântar, la intrare')[1], '1,30')
    await u.scrie('Justificarea lipsei pozelor', 'fără cameră')
    await u.apasa(u.buton('Înregistrează etapa 1'))
    await u.apasa(u.buton('Continuă acum cu etapa 2'))
    ceas = ORA(11)
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,30'); await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,60')   // +300 g > 100 g
    expect(u.text()).toContain('propun UMED')
    await u.apasa(u.buton('USCAT'))
    expect(u.text()).toContain('Ai ales altceva decât calculul (UMED)')
    expect(u.camp('Ai ales altceva decât calculul (UMED)').value).toBe('')            // câmpul distinct e gol: NU arată observațiile automate
    expect(u.text()).not.toContain('Motiv deja scris în observații')
    expect(u.buton('Termină etapa 2').disabled).toBe(true)                            // textul automat nu satisface motivarea
    expect(u.text()).toContain('motivul scris de tine pentru verdictul diferit de calcul')
    await u.scrie('Ai ales altceva decât calculul (UMED)', 'ultimul burete cântărit cu apă de ploaie pe el')
    expect(u.text()).not.toContain('motivul scris de tine')
    expect(u.buton('Termină etapa 2').disabled).toBe(true)                            // USCAT cere și dovada
    await u.fotografiaza('Poza ultimului piston')
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(nou.id)).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform',
      observatii: `${textTrecere(2, '17.11.2026')}\n${PREFIX_MOTIV_VERDICT} ultimul burete cântărit cu apă de ploaie pe el` })
    expect(u.text()).toContain('Rezumat și raport')
    // după salvare, motivul e în observații: câmpul distinct nu mai apare gol ca „lipsă” la o reîntoarcere pe etapa 2 (pasul e dedus din date)
    expect(u.camp('Observații').value).toContain(PREFIX_MOTIV_VERDICT)
  })

  // P2 din review-ul final al PR #1127: salveaza pune pe ecran formularul CU motivul înaintea răspunsului, câmpul distinct se golește doar
  // după succes → o reîncercare nu are voie să adauge motivul a doua oară; motivul netrimis intră în ciorna locală
  const MOTIV = 'buretele ud la exterior, cântărit după ploaie'
  const laVerdictContrar = async u => {
    await u.apasa(u.buton('Continuă cu etapa 2'))
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,26')
    await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,45')        // +150 g > 100 g → propun UMED
    await u.apasa(u.buton('USCAT'))
    await u.scrie('Ai ales altceva', MOTIV)
  }
  const cheiCiorna = s => [...s.m.keys()].filter(k => k.includes('.ciorna.'))
  it('P2 (#1127 final): verdict contrar, salvarea REFUZATĂ de server, apoi reîncercare → motivul o singură dată în observații', async () => {
    const { client, st, T } = clientFals()
    etapa1Gata(T, 1)
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2); pozaServer(T, 1, 'piston_final')
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare, { ecranInitial: 'pasi', acum: () => ORA(9) })
    await laVerdictContrar(u)
    st.refuzaSalvari = 2
    await u.apasa(u.buton('Termină etapa 2'))
    await u.apasa(u.buton('Termină etapa 2'))                                        // a doua reîncercare, tot refuzată
    expect(u.text()).toContain('uscare: refuz simulat')
    expect(T.executie_uscari.get(1)).toMatchObject({ observatii: null, piston_final_rezultat: null })   // nimic scris
    expect(u.text()).toContain('Etapa 2 din 2')
    expect(u.camp('Ai ales altceva').value).toBe(MOTIV)                               // câmpul distinct se păstrează după refuz
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: `${PREFIX_MOTIV_VERDICT} ${MOTIV}` })
    expect(u.text()).toContain('Rezumat și raport')
    expect(cheiCiorna(stocare)).toEqual([])                                           // după succes: nicio ciornă rămasă (nici cu motivul)
  })

  it('P2 (#1127 final): motivul netrimis intră în ciornă; eroare de rețea → reîncărcare → motivul revine → salvare: motivul o singură dată', async () => {
    const { client, st, T } = clientFals()
    etapa1Gata(T, 1)
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2); pozaServer(T, 1, 'piston_final')
    const stocare = stocareFalsa()
    const ex = { ecranInitial: 'pasi', acum: () => ORA(9) }
    const u = await monteaza(client, stocare, ex)
    await laVerdictContrar(u)
    // (a) reîncărcare ÎNAINTE de orice apăsare: motivul scris doar în câmpul distinct revine din ciornă
    expect(cheiCiorna(stocare).map(k => JSON.parse(stocare.getItem(k)).motivVerdict)).toEqual([MOTIV])
    const v = await monteaza(client, stocare, ex)
    await v.apasa(v.buton('Continuă cu etapa 2'))
    expect(v.text()).toContain('Ai modificări nesalvate')
    await v.apasa(v.buton('Restaurez'))
    expect(v.camp('Ai ales altceva').value).toBe(MOTIV)
    // (b) „Termină etapa 2” cu rezultat necunoscut (rețea; serverul nu a scris), apoi reîncărcare
    st.auto = false
    await v.apasa(v.buton('Termină etapa 2'))
    await v.elibereaza(salvari(st).at(-1), 'eroare')
    st.auto = true
    expect(T.executie_uscari.get(1).observatii).toBe(null)
    const w = await monteaza(client, stocare, ex)
    await w.apasa(w.buton('Continuă cu etapa 2'))
    await w.apasa(w.buton('Restaurez'))
    expect(w.camp('Ai ales altceva').value).toBe(MOTIV)                               // motivul revine în câmpul lui
    await w.apasa(w.butonExact('Renunț'))                                             // cererea pierdută: serverul confirmă că nu s-a aplicat
    expect(w.text()).toContain('am retras-o definitiv')
    expect(w.buton('Termină etapa 2').disabled).toBe(false)
    await w.apasa(w.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform', observatii: `${PREFIX_MOTIV_VERDICT} ${MOTIV}` })
    expect(w.text()).toContain('Rezumat și raport')
    expect(cheiCiorna(stocare)).toEqual([])
  })

  // ── 17.11.2026, proba pe mediul publicat (RAPORT.md, defectul 1): „Salvează pe parcurs” nu avansează pasul și nu lasă raportul fără concluzie ──
  // Inventarul tranzițiilor de pas ale ecranului (ce buton / ce scriere duce unde), parcurs de testele de mai jos:
  //   lista → „＋ Uscare nouă” → tronson · lista → cardul „Continuă cu etapa 1 / 2” sau „Generează raportul →” → pasul DEDUS din date
  //   tronson → „Începe · etapa 1” (creare) → etapa 1
  //   etapa 1 → „✓ Înregistrează etapa 1” (succes) → „Etapa 1 înregistrată” → „Continuă acum cu etapa 2” → etapa 2 (sau „← Lista”)
  //   etapa 1 → „💾 Salvează pe parcurs” / o poză → etapa 1 (ȚINUT pe loc, chiar cu datele etapei complete; înainte sărea la etapa 2)
  //   etapa 2 → „✓ Termină etapa 2” (succes: concluzia din verdict + timpul) → rezumat
  //   etapa 2 → „💾 Salvează pe parcurs” / o poză → etapa 2 (datele etapei FĂRĂ concluzie nu sunt „etapa terminată”; înainte: rezumat blocat)
  //   rezumat → „💾 Salvează detaliile” → rezumat · „📄 Generează raportul” → închis · „↻ Trecere nouă” → tronson (raport nou)
  //   oriunde → „← Lista”; „Vezi / corectează toate datele” → formularul complet → „← Înapoi la pași” → același pas
  // Valorile (1,25 / 1,30 → 1,40 / 1,35 = +50 g ≤ 100 g → USCAT / CONFORM; 10:00 → 11:00 = 60 min) sunt socotite de mână (L25).
  const PASI_E1 = ['acum', 'kg1', 'kg2'], POZE_E1 = [['Poza cântarului', 0], ['Poza cântarului', 1], ['Poza ansamblului de pistoane', 0]]
  const PASI_E2 = ['acum', 'kg1', 'kg2', 'verdict'], POZE_E2 = [['Poza cântarului', 0], ['Poza cântarului', 1], ['Poza ultimului piston', 0]]
  const faPas = async (u, k, etapa) => {
    const kg = etapa === 1 ? ['Greutatea pe cântar, la intrare', '1,25', '1,30'] : ['Greutatea pe cântar, la ieșire', '1,40', '1,35']
    if (k === 'acum') await u.apasa(u.buton('⟳ Acum'))
    else if (k === 'kg1') await u.scrieEl(u.campuri(kg[0])[0], kg[1])
    else if (k === 'kg2') await u.scrieEl(u.campuri(kg[0])[1], kg[2])
    else if (k === 'verdict') await u.apasa(u.buton('USCAT (propus)'))
  }
  const salveazaPeParcurs = async (u, et) => { const b = u.buton('Salvează pe parcurs'); expect(b.disabled, et).toBe(false); await u.apasa(b) }
  // rezumatul: detaliile cerute de beneficiar, salvate, bifa, „Generează raportul” (fără formularul complet)
  const detaliiSiGenereaza = async (u, T, id, et) => {
    expect(u.text(), et).toContain('Rezumat și raport')
    await u.scrie('Temperatura exterioară (°C)', '8')
    await u.scrie('Denumire 1', 'Compresor 12 bar')
    await u.scrie('PIG metalic [buc]', '0')
    await u.scrie('Piston poliuretan [buc]', '0')
    await u.scrie('Presiunea (bar)', '2,5')
    await u.scrie('Justificarea lipsei', 'manometru și termometru fără ecran lizibil')
    await u.apasa(u.buton('Salvează detaliile'))
    await u.bifeaza('Am verificat detaliile')
    expect(u.buton('Generează raportul').disabled, et + ' · Generează raportul').toBe(false)
    await u.apasa(u.buton('Generează raportul'))
    expect(T.executie_uscari.get(id).stare, et).toBe('inchisa')
    expect(u.text(), et).toContain('Raport generat (închis)')
  }
  const etapa2SiRaport = async (u, T, id, et) => {
    for (const k of PASI_E2) await faPas(u, k, 2)
    for (const [t, i] of POZE_E2) await u.fotografiaza(t, i)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(id), et).toMatchObject({ piston_final_rezultat: 'uscat', concluzie: 'conform', timp_deplasare_min: 60 })
    await detaliiSiGenereaza(u, T, id, et)
  }
  const drumEtapa1 = async ({ salvariDupa, pozeIntai }) => {
    const et = `etapa 1, salvări după [${[...salvariDupa].join(', ')}], pozele ${pozeIntai ? 'înainte' : 'după'}`
    const { client, T } = clientFals()
    T.executie_uscari.set(1, RAP(1, { bureti_buc: 2, cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })), data_operatie: '2026-11-17' }))
    let ceas = ORA(8)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ceas, comprima: async () => new Blob(['x']) })
    await u.apasa(u.buton('Continuă cu etapa 1'))
    const poze = async () => { for (const [t, i] of POZE_E1) await u.fotografiaza(t, i) }
    const campuri = async () => { for (const k of PASI_E1) { await faPas(u, k, 1); if (salvariDupa.has(k)) await salveazaPeParcurs(u, et) } }
    if (pozeIntai) { await poze(); await campuri() } else { await campuri(); await poze() }
    // ecranul a rămas pe etapa 1, cu butonul etapei activ: nimic nu a sărit la etapa 2 sau peste confirmare
    expect(u.text(), et).toContain('Etapa 1 din 2')
    expect(u.text(), et).not.toContain('Etapa 2 din 2')
    expect(u.text(), et).not.toContain('Etapa 1 înregistrată')
    expect(u.buton('Înregistrează etapa 1').disabled, et).toBe(false)
    await u.apasa(u.buton('Înregistrează etapa 1'))
    expect(u.text(), et).toContain('Etapa 1 înregistrată')
    expect(T.executie_uscari.get(1), et).toMatchObject({ ora_inceput: '2026-11-17T08:00:00.000Z', cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: null, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: null, motiv: null }] })
    await u.apasa(u.buton('Continuă acum cu etapa 2'))
    expect(u.text(), et).toContain('Etapa 2 din 2')
    ceas = ORA(9)
    await etapa2SiRaport(u, T, 1, et)
  }
  const drumEtapa2 = async ({ salvariDupa, pozeIntai }) => {
    const et = `etapa 2, salvări după [${[...salvariDupa].join(', ')}], pozele ${pozeIntai ? 'înainte' : 'după'}`
    const { client, T } = clientFals()
    etapa1Gata(T, 1)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9), comprima: async () => new Blob(['x']) })
    await u.apasa(u.buton('Continuă cu etapa 2'))
    const poze = async () => { for (const [t, i] of POZE_E2) await u.fotografiaza(t, i) }
    const campuri = async () => { for (const k of PASI_E2) { await faPas(u, k, 2); if (salvariDupa.has(k)) await salveazaPeParcurs(u, et) } }
    if (pozeIntai) { await poze(); await campuri() } else { await campuri(); await poze() }
    // ecranul a rămas pe etapa 2 (nu rezumatul fără câmp de concluzie); salvările pe parcurs n-au pus concluzia, o pune butonul etapei
    expect(u.text(), et).toContain('Etapa 2 din 2')
    expect(u.text(), et).not.toContain('Rezumat și raport')
    expect(u.text(), et).not.toContain('concluzia (conform / neconform)')
    expect(T.executie_uscari.get(1).concluzie, et).toBe(null)
    expect(u.buton('Termină etapa 2').disabled, et).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1), et).toMatchObject({ ora_final: '2026-11-17T09:00:00.000Z', piston_final_rezultat: 'uscat', concluzie: 'conform', timp_deplasare_min: 60 })
    await detaliiSiGenereaza(u, T, 1, et)
  }
  it('17.11.2026 (defectul 1): TOATE drumurile etapei 1 cu „Salvează pe parcurs” apăsat după oricare din ora / greutăți, cu pozele înainte sau după: pasul nu sare, raportul se generează din pași', async () => {
    for (const pozeIntai of [false, true]) for (let m = 0; m < 1 << PASI_E1.length; m++) {
      await drumEtapa1({ salvariDupa: new Set(PASI_E1.filter((_, i) => (m >> i) & 1)), pozeIntai })
    }
  })
  it('17.11.2026 (defectul 1): TOATE drumurile etapei 2 cu „Salvează pe parcurs” apăsat după oricare din ora / greutăți / verdict, cu pozele înainte sau după (scenariul probei: salvare cu tot, apoi ultima poză): nu sare la rezumat, concluzia o pune „Termină etapa 2”', async () => {
    for (const pozeIntai of [false, true]) for (let m = 0; m < 1 << PASI_E2.length; m++) {
      await drumEtapa2({ salvariDupa: new Set(PASI_E2.filter((_, i) => (m >> i) & 1)), pozeIntai })
    }
  })
  it('17.11.2026 (defectul 1): un raport deja ajuns în starea blocată (datele etapei 2 complete, fără concluzie — salvat pe parcurs / de pe alt telefon) se deschide pe ETAPA 2 și se termină din pași', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'uscat', cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.32, motiv: null }] })
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2); pozaServer(T, 1, 'piston_final')
    expect(lipsaDinRand(T.executie_uscari.get(1), [...T.executie_uscare_poze.values()])).toContain('concluzie')   // regula comună o cere, pașii n-au câmp pentru ea
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    expect(u.buton('Tronson Tr. test').textContent).toContain('Continuă cu etapa 2')
    await u.apasa(u.buton('Continuă cu etapa 2'))
    expect(u.text()).toContain('Etapa 2 din 2')
    expect(u.text()).not.toContain('Rezumat și raport')
    expect(u.campuri('Greutatea pe cântar, la ieșire').map(x => x.value)).toEqual(['1,3', '1,32'])
    expect(u.butoane().some(b => b.textContent.includes('Salvează pe parcurs'))).toBe(false)   // nimic modificat
    expect(u.buton('Termină etapa 2').disabled).toBe(false)                                     // nimic de completat: butonul etapei pune concluzia și timpul
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ ora_final: '2026-11-17T09:00:00.000Z', concluzie: 'conform', timp_deplasare_min: 60 })   // ora ieșirii neschimbată
    await detaliiSiGenereaza(u, T, 1, 'raportul blocat')
  })
  it('17.11.2026 (defectul 2): observații preexistente oarecare NU țin loc de motiv la verdictul contrar; motivul cu eticheta lui (raport vechi) e recunoscut', async () => {
    const { client, T } = clientFals()
    const NOTA = 'TEST automat 17.11.2026 noaptea — de ignorat'
    etapa1Gata(T, 1, { observatii: NOTA })
    pozaServer(T, 1, 'cantar_iesire', 1); pozaServer(T, 1, 'cantar_iesire', 2)
    etapa1Gata(T, 2, { tronson: 'Tr. vechi', observatii: `${NOTA}\n${PREFIX_MOTIV_VERDICT} apă de ploaie pe burete` })
    pozaServer(T, 2, 'cantar_iesire', 1); pozaServer(T, 2, 'cantar_iesire', 2)
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(9) })
    const contraCalculului = async () => {
      await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[0], '1,26')
      await u.scrieEl(u.campuri('Greutatea pe cântar, la ieșire')[1], '1,35')        // +50 g ≤ 100 g → propun USCAT
      expect(u.text()).toContain('propun USCAT')
      await u.apasa(u.buton('UMED'))                                                   // contra calculului
      expect(u.text()).toContain('Ai ales altceva decât calculul (USCAT)')
    }
    await u.apasa(u.buton('Tronson Tr. test'))
    await contraCalculului()
    expect(u.text()).not.toContain('Motiv deja scris în observații')                   // nota liberă nu e motiv
    expect(lipsuri(u)).toEqual(['motivul scris de tine pentru verdictul diferit de calcul'])
    expect(u.buton('Termină etapa 2').disabled).toBe(true)
    await u.scrie('Ai ales altceva decât calculul (USCAT)', 'buretele ud la exterior')
    expect(lipsuri(u)).toEqual([])
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
    await u.apasa(u.buton('Termină etapa 2'))
    expect(T.executie_uscari.get(1)).toMatchObject({ piston_final_rezultat: 'umed', concluzie: 'neconform', observatii: `${NOTA}\n${PREFIX_MOTIV_VERDICT} buretele ud la exterior` })
    expect(u.text()).toContain('Rezumat și raport')
    await u.apasa(u.buton('← Lista'))
    // raportul vechi, cu eticheta deja în observații: motivul e recunoscut (doar textul de sub etichetă), câmpul distinct rămâne gol
    await u.apasa(u.buton('Tronson Tr. vechi'))
    await contraCalculului()
    expect(u.text()).toContain('Motiv deja scris în observații: „apă de ploaie pe burete”')
    expect(u.camp('Ai ales altceva decât calculul (USCAT)').value).toBe('')
    expect(lipsuri(u)).toEqual([])
    expect(u.buton('Termină etapa 2').disabled).toBe(false)
  })
  it('17.11.2026: bifa „Am verificat detaliile” are ținta de atingere de cel puțin 44 px și nu se strivește lângă text', async () => {
    const { client, T } = clientFals()
    completServer(T, 1, { poze_justificare: 'aparatul foto defect' })
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    await u.apasa(u.buton('Tronson Tr. 1'))
    const l = [...u.d.querySelectorAll('label')].find(x => x.textContent.includes('Am verificat detaliile'))
    expect(l, 'eticheta bifei (toată e apăsabilă)').toBeTruthy()
    const b = l.querySelector('input[type=checkbox]')
    expect(px(b.style.width)).toBeGreaterThanOrEqual(44)
    expect(px(b.style.height)).toBeGreaterThanOrEqual(44)
    expect(b.style.flexShrink).toBe('0')
    expect(px(l.style.minHeight)).toBeGreaterThanOrEqual(44)
  })
  it('17.11.2026: „Uscare nouă” neatinsă nu lasă ciornă (și nu întreabă la ieșire); o ciornă identică cu formularul propus nu se mai oferă; o schimbare reală, da', async () => {
    const { client, T } = clientFals()
    T.executie_uscari.set(5, RAP(5, { stare: 'inchisa', inchis_la: '2026-11-16T10:00:00Z', concluzie: 'conform', constructor: 'Firma A', utilaje: [{ denumire: 'Compresor', buc: 1 }] }))   // precompletarea
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare, { ecranInitial: 'pasi', acum: () => ORA(8) })
    let intrebari = 0
    u.j.window.confirm = () => { intrebari += 1; return true }
    await u.apasa(u.buton('Uscare nouă'))
    expect(u.text()).toContain('Pe ce tronson faci uscarea?')
    expect(u.camp('Lungime (m)').value).toBe('')
    expect(cheiCiorna(stocare)).toEqual([])                                             // nimic scris pentru un formular neatins
    await u.apasa(u.buton('← Lista'))
    expect(intrebari).toBe(0)                                                           // nimic de pierdut: nicio întrebare
    await u.apasa(u.buton('Uscare nouă'))
    expect(u.text()).not.toContain('Ai modificări nesalvate')
    expect(u.camp('Tronson (cum apare în raport)').disabled).toBe(false)
    await u.apasa(u.buton('← Lista'))
    // o ciornă veche, identică cu formularul propus (scrisă de versiunea dinainte): nu se oferă, se aruncă
    const propus = formularPasNou({ uscari: [...T.executie_uscari.values()], constructor: 'Firma A', acum: ORA(8) })
    stocare.setItem('gazpet.uscare.ciorna.v2:u1:1:nou', JSON.stringify({ baza: null, form: propus, la: '2026-11-17T06:00:00.000Z' }))
    await u.apasa(u.buton('Uscare nouă'))
    expect(u.text()).not.toContain('Ai modificări nesalvate')
    expect(cheiCiorna(stocare)).toEqual([])
    // o schimbare reală: ciorna se scrie, ieșirea întreabă, la următoarea deschidere se oferă
    await u.scrie('Tronson (cum apare în raport)', 'Tr. ciornă')
    expect(cheiCiorna(stocare)).toHaveLength(1)
    await u.apasa(u.buton('← Lista'))
    expect(intrebari).toBe(1)
    await u.apasa(u.buton('Uscare nouă'))
    expect(u.text()).toContain('Ai modificări nesalvate')
    await u.apasa(u.buton('Restaurez'))
    expect(u.camp('Tronson (cum apare în raport)').value).toBe('Tr. ciornă')
  })
  it('17.11.2026: „Trecerea N” numără doar trecerile NECONFORME de pe același interval; rapoartele conforme sau în lucru de pe el nu', async () => {
    const { client, T } = clientFals()
    etapa1Gata(T, 1, { proba_id: null, stare: 'inchisa', inchis_la: '2026-11-17T09:30:00Z', ora_final: '2026-11-17T09:00:00Z', piston_final_rezultat: 'umed', concluzie: 'neconform',
      cantariri: [{ nr: 1, intrare_kg: 1.25, iesire_kg: 1.3, motiv: null }, { nr: 2, intrare_kg: 1.3, iesire_kg: 1.6, motiv: null }] })
    T.executie_uscari.set(2, RAP(2, { tronson: 'Tr. conform', data_operatie: '2026-11-10', stare: 'inchisa', inchis_la: '2026-11-10T10:00:00Z', concluzie: 'conform', piston_final_rezultat: 'uscat' }))   // alt raport reușit, același interval
    T.executie_uscari.set(3, RAP(3, { tronson: 'Tr. în lucru', bureti_buc: 2, cantariri: [1, 2].map(nr => ({ nr, intrare_kg: null, iesire_kg: null, motiv: null })) }))
    const u = await monteaza(client, stocareFalsa(), { ecranInitial: 'pasi', acum: () => ORA(10) })
    await u.apasa(u.buton('Tr. test'))
    await u.apasa(u.buton('Trecere nouă pe același tronson'))
    await u.apasa(u.buton('Începe'))
    const nou = [...T.executie_uscari.values()].find(r => ![1, 2, 3].includes(r.id))
    expect(nou.observatii).toBe(textTrecere(2, '17.11.2026'))
  })
})
