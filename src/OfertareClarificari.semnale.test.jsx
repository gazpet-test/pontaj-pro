// TKT-2026-0329 A, PR-UI Task 10: ciornele auto_surse_* în ❓ Clarificări și „răspuns posibil relevant” (spec §3.6). Componenta reală
// (ClarificariPanel) montată cu react-dom în jsdom, client Supabase FALS cu numărarea apelurilor (from / rpc / functions.invoke / storage / auth);
// sub-panourile grele (puncte, temeiuri, poarta de procesare, conversia în PDF) sunt înlocuite cu stub-uri. jsdom nu e dependență a proiectului
// (ca la ActivitatiProiectPanel.test.jsx): fără el suita e SĂRITĂ VIZIBIL. Date sintetice (licitația 900001).
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// amana[tabel] = rows => Promise<{data, error}>: un select pe acel tabel rămâne în zbor până îl rezolvă testul (probele async, review r2)
const st = vi.hoisted(() => ({ rpc: {}, tabele: {}, erori: {}, cereri: [], invocari: 0, scrieri: [], amana: {} }))
vi.mock('./lib/supabase.js', () => ({ supabase: clientFals(st) }))
vi.mock('./OfertareClarificariPuncte.jsx', () => ({ default: () => null }))
vi.mock('./OfertareTemeiuri.jsx', () => ({ default: () => null }))
vi.mock('./OfertareTriere.jsx', () => ({ poatePorniProcesarea: () => false, MOTIV_POARTA: 'poarta' }))
vi.mock('./CitesteOricePanel.jsx', () => ({ imageToPdf: async f => f }))
import ClarificariPanel from './OfertareClarificari.jsx'

function clientFals(s) {
  const rpc = (fn, args) => {
    s.cereri.push({ rpc: fn, args })
    const r = s.rpc[fn]
    return Promise.resolve(typeof r === 'function' ? r(args) : (r ?? { data: null, error: { message: `rpc necunoscut ${fn}` } }))
  }
  return {
    rpc: (fn, args) => ({ then: (ok, ko) => rpc(fn, args).then(ok, ko), range: (a, b) => ({ then: (ok, ko) => rpc(fn, { ...args, _range: [a, b] }).then(ok, ko) }), catch: () => rpc(fn, args) }),
    functions: { invoke: async (fn, o) => { s.invocari++; s.cereri.push({ invoke: fn, o }); return { data: null, error: { message: 'nu se apelează în test' } } } },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'fără storage în test' } }), upload: async () => ({ error: { message: 'fără storage' } }) }) },
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: tabel => {
      const q = { tabel, filtre: [], unic: false, op: 'select' }
      for (const m of ['select', 'order', 'limit', 'in', 'like']) q[m] = () => q
      q.eq = (c, v) => { q.filtre.push([c, v]); return q }
      q.maybeSingle = () => { q.unic = true; return q }
      q.single = () => { q.unic = true; return q }
      for (const op of ['insert', 'update', 'delete']) q[op] = (p) => { q.op = op; q.payload = p; return q }
      q.then = (ok, ko) => {
        s.cereri.push({ tabel, op: q.op, filtre: q.filtre })
        if (q.op !== 'select') { s.scrieri.push({ tabel, op: q.op, payload: q.payload, filtre: q.filtre }); return Promise.resolve({ data: null, error: null }).then(ok, ko) }
        if (s.erori[tabel]) return Promise.resolve({ data: null, error: s.erori[tabel] }).then(ok, ko)
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
if (!JSDOM) console.warn(`[OfertareClarificari.semnale.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

const LIC = { id: 900001, nr_anunt: 'CN-TEST', obiect: 'Obiect de test', status: 'in_lucru', termen_depunere: '2027-01-15' }
const LIC_B = { id: 900002, nr_anunt: 'CN-TEST-B', obiect: 'A doua licitație', status: 'in_lucru', termen_depunere: '2027-02-15' }
const CLAR_B = [{ id: 9, licitatie_id: LIC_B.id, nr: 1, intrebare: 'Întrebarea licitației B', status: 'de_trimis', origine: 'manual', cheie: null, fisier_path: null, raspuns: null }]
const DOC_RASP = 301, DOC_RASP_NECITIT = 302, DOC_RASP2 = 303
const CLAR = [
  { id: 1, licitatie_id: LIC.id, nr: 1, intrebare: 'Întrebare scrisă de mână', status: 'trimisa', origine: 'manual', cheie: null, fisier_path: null, raspuns: null },
  { id: 2, licitatie_id: LIC.id, nr: 2, intrebare: 'Vă rugăm să precizați cantitatea pentru conducta DN 160.', status: 'de_trimis', origine: 'automat', cheie: 'auto_surse_0123456789abcdef',
    sursa: 'surse_auto:102,gen_abc,ev_def', baza_generare: { evaluare: 'surse_v1', verdict: 'diferenta', a: 6400, b: 3995, prag: 0.05 } },
]
// review r1 P2: documentele au text_extras, dar NICIO citire AI (analiza.citire_noi lipsă) — secțiunea nouă trebuie să meargă fără ea
const DOCS = [
  { id: DOC_RASP, licitatie_id: LIC.id, nume_original: 'Raspuns autoritate.pdf', tip: 'raspuns_clarificare', aparut_ulterior: true, fisier_path: 'x/r.pdf', created_at: '2026-11-27T10:00:00Z',
    status_procesare: 'procesat', text_extras: '⟦PAGINA 1⟧ Răspuns: pentru conducta PE100 DN 160, lungimea corectă este 3.995 m.', analiza: null },
  { id: DOC_RASP_NECITIT, licitatie_id: LIC.id, nume_original: 'Raspuns necitit.pdf', tip: 'raspuns_clarificare', aparut_ulterior: true, fisier_path: 'x/n.pdf', created_at: '2026-11-27T11:00:00Z',
    status_procesare: 'neprocesat', text_extras: null, analiza: null },
  { id: DOC_RASP2, licitatie_id: LIC.id, nume_original: 'Raspuns 2.pdf', tip: 'raspuns_clarificare', aparut_ulterior: true, fisier_path: 'x/r2.pdf', created_at: '2026-11-27T12:00:00Z',
    status_procesare: 'procesat', text_extras: '⟦PAGINA 1⟧ Erată: conducta DN 160 are 4.100 m.', analiza: null },
]
const SEMNALE = [
  { semnal: { id: 50, licitatie_id: LIC.id, element: 'teava_pe_dn160', obiect_cheie: '*', verdict: 'diferenta', valoare_a: 6400, valoare_b: 3995, clarificare_id: 2 }, rezolvat: false, actual: true, in_curs: false, masuratori: [] },
  { semnal: { id: 51, licitatie_id: LIC.id, element: 'teava_pe_dn160', obiect_cheie: '*', verdict: 'diferenta', valoare_a: 10, valoare_b: 20, clarificare_id: null }, rezolvat: true, actual: true, in_curs: false, masuratori: [] },
]
const BAZA = [{ id: 2, licitatie_id: LIC.id, status: 'de_trimis', stare: 'necesita_review', mod_ciorna: 'surse', mod_curent: 'surse', amprenta_curenta: 'tok', marcaj_planse: false,
  text: 'necesită review — aprobă textul exact pe baza curentă', detalii: { evaluare: 'surse_v1', stare: 'necesita_review', diferente: { verdict: { vechi: 'diferenta', acum: 'diferenta' }, a: { vechi: 6400, acum: 6400 }, b: { vechi: 3995, acum: 3995 }, prag: { vechi: 0.05, acum: 0.1 } } } }]

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.rpc = {}; st.tabele = {}; st.erori = {}; st.cereri = []; st.invocari = 0; st.scrieri = []; st.amana = {}; vi.restoreAllMocks() })

function stareImplicita() {
  st.rpc = {
    fn_ofertare_source_pack_poate_decide: { data: true, error: null },
    ofertare_clarificari_notifica: { data: { ok: true }, error: null },
    fn_ofertare_semnale_lista: (args) => ({ data: args._range && args._range[0] === 0 ? SEMNALE : [], error: null }),
    fn_ofertare_semnal_raspuns_leaga: (args) => ({ data: { ok: true, semnal_id: args.p_semnal_id, clarificare: 'retrasa' }, error: null }),
  }
  st.tabele = { ofertare_clarificari: CLAR, profiles: [{ id: 'u1', name: 'Test' }], ofertare_documente_atribuire: DOCS, v_ofertare_clarificari_baza: BAZA }
}
async function monteaza({ licitatii = [LIC] } = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const toast = vi.fn()
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 80; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<ClarificariPanel licitatii={licitatii} profile={{ id: 'u1' }} showToast={toast} initialLicId={LIC.id} />) })
  await asteapta()
  let demontat = false
  const demonteaza = () => { if (!demontat) { demontat = true; act(() => root.unmount()); Object.assign(globalThis, vechi) } }
  curata.push(demonteaza)
  const d = j.window.document
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(j.window.HTMLInputElement.prototype, 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
  }
  // schimbarea licitației din selectorul din antet (primul <select> din ecran)
  const alegeLicitatia = async (id) => {
    const sel = d.querySelector('select')
    const set = Object.getOwnPropertyDescriptor(j.window.HTMLSelectElement.prototype, 'value').set
    await act(async () => { set.call(sel, String(id)); sel.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  const buton = (txt) => [...d.querySelectorAll('button')].find(b => b.textContent.includes(txt))
  const butoane = (txt) => [...d.querySelectorAll('button')].filter(b => b.textContent.includes(txt))
  const notificari = () => st.cereri.filter(c => c.rpc === 'ofertare_clarificari_notifica').map(c => c.args.p_licitatie_id)
  return { d, toast, apasa, scrie, buton, butoane, alegeLicitatia, asteapta, act, demonteaza, notificari, text: () => d.body.textContent }
}

dom('Clarificări — ciornele auto_surse_* și „răspuns posibil relevant” (jsdom)', () => {
  it('ui_fara_stergere_auto: butonul de ștergere lipsește pe auto_surse_x, rămâne pe întrebarea manuală; panoul bazei arată diferențele semnalului', async () => {
    stareImplicita()
    const { d, text } = await monteaza()
    const randuri = [...d.querySelectorAll('[data-clarificare]')]
    expect(randuri.map(r => r.getAttribute('data-clarificare'))).toEqual(['1', '2'])
    const stergere = r => [...r.querySelectorAll('button')].find(b => b.getAttribute('data-actiune') === 'sterge')
    expect(stergere(randuri[0])).toBeTruthy()
    expect(stergere(randuri[1])).toBeUndefined()
    // ciorna automată: eticheta „generată de platformă” (nu „scrisă manual”, PR #1205); panoul bazei cu textul serverului și diferența de prag
    expect(randuri[1].textContent).toContain('🤖 generată de platformă')
    expect(randuri[0].textContent).toContain('👤 scrisă manual')
    expect(text()).toContain('necesită review — aprobă textul exact pe baza curentă')
    expect(text()).toContain('prag 5 % → 10 %')
    expect(st.invocari).toBe(0)
  })
  it('panoul de legare: semnalul propus, „✓ leagă” dezactivat cât câmpul e gol, „ia B” completează cu valoare_b, apăsarea cheamă RPC-ul cu valoarea; zero invoke', async () => {
    stareImplicita()
    const { d, apasa, buton, butoane, text, toast } = await monteaza()
    const deschide = butoane('La ce întrebări răspunde?')
    expect(deschide.length).toBe(3)   // și fără citire AI (review r1 P2)
    await apasa(deschide[0])   // documentul cu text (fără analiză AI)
    expect(text()).toContain('Semnale posibil relevante')
    const sectiune = d.querySelector('[data-semnale-relevante]')
    expect(sectiune).toBeTruthy()
    expect(sectiune.textContent).toContain('DN 160 apare în răspuns')
    // semnalul rezolvat (51) nu e propus; doar 50
    expect([...sectiune.querySelectorAll('[data-semnal-propus]')].map(e => e.getAttribute('data-semnal-propus'))).toEqual(['50'])
    const leaga = buton('✓ leagă')
    expect(leaga.disabled).toBe(true)
    const camp = sectiune.querySelector('input[type="number"]')
    expect(camp.value).toBe('')
    await apasa(buton('ia B'))
    expect(camp.value).toBe('3995')
    expect(buton('✓ leagă').disabled).toBe(false)
    await apasa(buton('ia A'))
    expect(camp.value).toBe('6400')
    await apasa(buton('✓ leagă'))
    const apel = st.cereri.find(c => c.rpc === 'fn_ofertare_semnal_raspuns_leaga')
    expect(apel.args).toEqual({ p_semnal_id: 50, p_document_id: DOC_RASP, p_valoare: 6400 })
    expect(st.invocari).toBe(0)
    expect(toast.mock.calls.some(c => String(c[0]).includes('legat de răspuns') && c[1] !== 'err')).toBe(true)
    // secțiunea nu scrie direct în tabele
    expect(st.scrieri.filter(s => s.tabel === 'ofertare_cantitati_semnale' || s.tabel === 'ofertare_clarificari')).toEqual([])
  })
  it('review r1 P2: valoarea aleasă pe răspunsul D1 NU reapare la D2 pentru același semnal — câmpul pornește gol, „✓ leagă” dezactivat', async () => {
    stareImplicita()
    const { d, apasa, buton, butoane } = await monteaza()
    await apasa(butoane('La ce întrebări răspunde?')[0])   // D1
    await apasa(buton('ia B'))
    expect(d.querySelector('[data-semnale-relevante] input[type="number"]').value).toBe('3995')
    await apasa(buton('Renunță'))
    expect(d.querySelector('[data-semnale-relevante]')).toBeNull()
    await apasa(butoane('La ce întrebări răspunde?')[2])   // D2, același semnal 50
    const sectiune = d.querySelector('[data-semnale-relevante]')
    expect([...sectiune.querySelectorAll('[data-semnal-propus]')].map(e => e.getAttribute('data-semnal-propus'))).toEqual(['50'])
    expect(sectiune.querySelector('input[type="number"]').value).toBe('')
    expect(buton('✓ leagă').disabled).toBe(true)
    // legarea pe D2 trimite documentul D2
    await apasa(buton('ia A'))
    await apasa(buton('✓ leagă'))
    expect(st.cereri.find(c => c.rpc === 'fn_ofertare_semnal_raspuns_leaga').args).toEqual({ p_semnal_id: 50, p_document_id: DOC_RASP2, p_valoare: 6400 })
  })
  it('document fără text_extras → „răspunsul nu e citit — nimic de propus”, fără propuneri și fără invoke', async () => {
    stareImplicita()
    const { d, apasa, butoane } = await monteaza()
    await apasa(butoane('La ce întrebări răspunde?')[1])
    const sectiune = d.querySelector('[data-semnale-relevante]')
    expect(sectiune.textContent).toContain('răspunsul nu e citit — nimic de propus')
    expect(sectiune.querySelectorAll('[data-semnal-propus]').length).toBe(0)
    expect(st.invocari).toBe(0)
  })
  it('lista semnalelor indisponibilă → secțiunea spune că nu poate propune (nu „niciun semnal relevant”)', async () => {
    stareImplicita()
    st.rpc.fn_ofertare_semnale_lista = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    const { d, apasa, butoane } = await monteaza()
    await apasa(butoane('La ce întrebări răspunde?')[0])
    const sectiune = d.querySelector('[data-semnale-relevante]')
    expect(sectiune.textContent).toContain('nu putem citi semnalele')
    expect(sectiune.textContent).not.toContain('niciun semnal')
  })
  // ─── probele async cerute la review r1 / r2 (L24): notificarea de review e chemată DOAR după ce o încărcare s-a aplicat → e martorul încărcărilor aplicate ───
  it('A → B → legarea pe A (RPC suspendat) se termină: ecranul rămâne pe B, fără toast-ul acțiunii vechi, fără a treia încărcare aplicată', async () => {
    stareImplicita()
    st.tabele.ofertare_clarificari = [...CLAR, ...CLAR_B]
    let rezolvaLegarea = null
    st.rpc.fn_ofertare_semnal_raspuns_leaga = () => new Promise(res => { rezolvaLegarea = res })
    const { apasa, buton, butoane, alegeLicitatia, asteapta, act, text, toast, notificari } = await monteaza({ licitatii: [LIC, LIC_B] })
    expect(text()).toContain('Întrebare scrisă de mână'); expect(notificari()).toEqual([LIC.id])
    await apasa(butoane('La ce întrebări răspunde?')[0])
    await apasa(buton('ia B'))
    await apasa(buton('✓ leagă'))          // RPC-ul rămâne în zbor
    expect(rezolvaLegarea).toBeTypeOf('function')
    await alegeLicitatia(LIC_B.id)        // omul trece pe B; B se încarcă
    expect(text()).toContain('Întrebarea licitației B'); expect(text()).not.toContain('Întrebare scrisă de mână')
    expect(notificari()).toEqual([LIC.id, LIC_B.id])
    await act(async () => { rezolvaLegarea({ data: { ok: true, semnal_id: 50, clarificare: 'retrasa' }, error: null }) }); await asteapta()
    // acțiunea veche s-a terminat: nu readuce A, nu anunță pe ecranul B, nu aplică o încărcare în plus
    expect(text()).toContain('Întrebarea licitației B'); expect(text()).not.toContain('Întrebare scrisă de mână')
    expect(toast.mock.calls.some(c => String(c[0]).includes('legat de răspuns'))).toBe(false)
    expect(notificari()).toEqual([LIC.id, LIC_B.id])
  })
  it('A → B → A cu încărcările lui A terminate INVERS: prima încărcare (veche) nu suprascrie a doua; demontarea cu o încărcare în zbor nu aplică nimic', async () => {
    stareImplicita()
    st.tabele.ofertare_clarificari = [...CLAR.map(q => ({ ...q })), ...CLAR_B]
    const pend = []
    st.amana.ofertare_clarificari = rows => new Promise(res => { pend.push(() => res({ data: rows, error: null })) })
    const { alegeLicitatia, asteapta, act, text, notificari, demonteaza } = await monteaza({ licitatii: [LIC, LIC_B] })
    expect(pend.length).toBe(1); expect(text()).not.toContain('Întrebare scrisă de mână'); expect(notificari()).toEqual([])
    await alegeLicitatia(LIC_B.id); expect(pend.length).toBe(2)
    await act(async () => { pend[1]() }); await asteapta()
    expect(text()).toContain('Întrebarea licitației B'); expect(notificari()).toEqual([LIC_B.id])
    // înapoi pe A; între timp textul lui A s-a schimbat pe server (v2) → a doua încărcare a lui A aduce v2
    st.tabele.ofertare_clarificari[0].intrebare = 'Întrebare A versiunea 2'
    await alegeLicitatia(LIC.id); expect(pend.length).toBe(3)
    await act(async () => { pend[2]() }); await asteapta()
    expect(text()).toContain('Întrebare A versiunea 2'); expect(notificari()).toEqual([LIC_B.id, LIC.id])
    // abia acum se termină PRIMA încărcare a lui A (v1): nu suprascrie v2, nu notifică
    await act(async () => { pend[0]() }); await asteapta()
    expect(text()).toContain('Întrebare A versiunea 2'); expect(text()).not.toContain('Întrebare scrisă de mână')
    expect(notificari()).toEqual([LIC_B.id, LIC.id])
    // demontare cu o încărcare în zbor: B se cere, ecranul se închide, răspunsul vine după → nimic aplicat, nicio excepție
    await alegeLicitatia(LIC_B.id); expect(pend.length).toBe(4)
    demonteaza()
    pend[3](); for (let i = 0; i < 80; i++) await Promise.resolve()
    expect(notificari()).toEqual([LIC_B.id, LIC.id])
  })
  it('legarea refuzată de server (CM_FARA_DREPT) → mesajul fără cod, nimic marcat ca legat', async () => {
    stareImplicita()
    st.rpc.fn_ofertare_semnal_raspuns_leaga = { data: null, error: { code: '42501', message: 'CM_FARA_DREPT: legarea raspunsului cere drept de decizie pe licitatie' } }
    const { apasa, buton, butoane, toast } = await monteaza()
    await apasa(butoane('La ce întrebări răspunde?')[0])
    await apasa(buton('ia B'))
    await apasa(buton('✓ leagă'))
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('legarea raspunsului cere drept de decizie pe licitatie'), 'err')
    expect(toast.mock.calls.some(c => c[0].includes('CM_FARA_DREPT'))).toBe(false)
  })
})
