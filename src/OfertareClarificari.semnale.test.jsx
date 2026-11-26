// TKT-2026-0329 A, PR-UI Task 10: ciornele auto_surse_* în ❓ Clarificări și „răspuns posibil relevant” (spec §3.6). Componenta reală
// (ClarificariPanel) montată cu react-dom în jsdom, client Supabase FALS cu numărarea apelurilor (from / rpc / functions.invoke / storage / auth);
// sub-panourile grele (puncte, temeiuri, poarta de procesare, conversia în PDF) sunt înlocuite cu stub-uri. jsdom nu e dependență a proiectului
// (ca la ActivitatiProiectPanel.test.jsx): fără el suita e SĂRITĂ VIZIBIL. Date sintetice (licitația 900001).
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const st = vi.hoisted(() => ({ rpc: {}, tabele: {}, erori: {}, cereri: [], invocari: 0, scrieri: [] }))
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
const DOC_RASP = 301, DOC_RASP_NECITIT = 302
const CLAR = [
  { id: 1, licitatie_id: LIC.id, nr: 1, intrebare: 'Întrebare scrisă de mână', status: 'trimisa', origine: 'manual', cheie: null, fisier_path: null, raspuns: null },
  { id: 2, licitatie_id: LIC.id, nr: 2, intrebare: 'Vă rugăm să precizați cantitatea pentru conducta DN 160.', status: 'de_trimis', origine: 'automat', cheie: 'auto_surse_0123456789abcdef',
    sursa: 'surse_auto:102,gen_abc,ev_def', baza_generare: { evaluare: 'surse_v1', verdict: 'diferenta', a: 6400, b: 3995, prag: 0.05 } },
]
const DOCS = [
  { id: DOC_RASP, licitatie_id: LIC.id, nume_original: 'Raspuns autoritate.pdf', tip: 'raspuns_clarificare', aparut_ulterior: true, fisier_path: 'x/r.pdf', created_at: '2026-11-27T10:00:00Z',
    status_procesare: 'procesat', text_extras: '⟦PAGINA 1⟧ Răspuns: pentru conducta PE100 DN 160, lungimea corectă este 3.995 m.', analiza: { citire_noi: { rezumat: 'r', citit_la: '2026-11-27T10:05:00Z', intrebari_raspunse: [] } } },
  { id: DOC_RASP_NECITIT, licitatie_id: LIC.id, nume_original: 'Raspuns necitit.pdf', tip: 'raspuns_clarificare', aparut_ulterior: true, fisier_path: 'x/n.pdf', created_at: '2026-11-27T11:00:00Z',
    status_procesare: 'neprocesat', text_extras: null, analiza: { citire_noi: { rezumat: '', intrebari_raspunse: [] } } },
]
const SEMNALE = [
  { semnal: { id: 50, licitatie_id: LIC.id, element: 'teava_pe_dn160', obiect_cheie: '*', verdict: 'diferenta', valoare_a: 6400, valoare_b: 3995, clarificare_id: 2 }, rezolvat: false, actual: true, in_curs: false, masuratori: [] },
  { semnal: { id: 51, licitatie_id: LIC.id, element: 'teava_pe_dn160', obiect_cheie: '*', verdict: 'diferenta', valoare_a: 10, valoare_b: 20, clarificare_id: null }, rezolvat: true, actual: true, in_curs: false, masuratori: [] },
]
const BAZA = [{ id: 2, licitatie_id: LIC.id, status: 'de_trimis', stare: 'necesita_review', mod_ciorna: 'surse', mod_curent: 'surse', amprenta_curenta: 'tok', marcaj_planse: false,
  text: 'necesită review — aprobă textul exact pe baza curentă', detalii: { evaluare: 'surse_v1', stare: 'necesita_review', diferente: { verdict: { vechi: 'diferenta', acum: 'diferenta' }, a: { vechi: 6400, acum: 6400 }, b: { vechi: 3995, acum: 3995 }, prag: { vechi: 0.05, acum: 0.1 } } } }]

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.rpc = {}; st.tabele = {}; st.erori = {}; st.cereri = []; st.invocari = 0; st.scrieri = []; vi.restoreAllMocks() })

function stareImplicita() {
  st.rpc = {
    fn_ofertare_source_pack_poate_decide: { data: true, error: null },
    ofertare_clarificari_notifica: { data: { ok: true }, error: null },
    fn_ofertare_semnale_lista: (args) => ({ data: args._range && args._range[0] === 0 ? SEMNALE : [], error: null }),
    fn_ofertare_semnal_raspuns_leaga: (args) => ({ data: { ok: true, semnal_id: args.p_semnal_id, clarificare: 'retrasa' }, error: null }),
  }
  st.tabele = { ofertare_clarificari: CLAR, profiles: [{ id: 'u1', name: 'Test' }], ofertare_documente_atribuire: DOCS, v_ofertare_clarificari_baza: BAZA }
}
async function monteaza() {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const toast = vi.fn()
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 80; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<ClarificariPanel licitatii={[LIC]} profile={{ id: 'u1' }} showToast={toast} initialLicId={LIC.id} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const d = j.window.document
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(j.window.HTMLInputElement.prototype, 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
  }
  const buton = (txt) => [...d.querySelectorAll('button')].find(b => b.textContent.includes(txt))
  const butoane = (txt) => [...d.querySelectorAll('button')].filter(b => b.textContent.includes(txt))
  return { d, toast, apasa, scrie, buton, butoane, text: () => d.body.textContent }
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
    expect(deschide.length).toBe(2)
    await apasa(deschide[0])   // documentul citit (are text)
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
