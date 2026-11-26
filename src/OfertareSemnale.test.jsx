// TKT-2026-0329 A, PR-UI Task 9: ecranul semnalelor „aceeași cantitate, documente diferite” (fișa licitației, lângă proba extractorului).
// Componenta reală montată cu react-dom în jsdom, client Supabase FALS (rpc + from, cu numărarea cererilor). jsdom nu e dependență a proiectului
// (ca la ActivitatiProiectPanel.test.jsx): fără el suita de ecran e SĂRITĂ VIZIBIL. Date sintetice (licitația 900001, documente DOC_F3_T / DOC_ATR_T).
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const st = vi.hoisted(() => ({ rpc: {}, tabele: {}, erori: {}, cereri: [] }))
vi.mock('./lib/supabase.js', () => ({ supabase: clientFals(st) }))
import OfertareSemnale, { incarcaSemnale, MESAJ_NEACTIV, MESAJ_EROARE } from './OfertareSemnale.jsx'
import { CULORI } from './ofertareSemnale.js'

// client fals: rpc(fn, args) → thenable cu .range(); from(tabel) → select/eq/order/limit/maybeSingle/then
function clientFals(s) {
  const raspuns = (fn, args, range) => {
    s.cereri.push({ fn, args, range })
    const r = s.rpc[fn]
    if (typeof r === 'function') return Promise.resolve(r(args, range))
    return Promise.resolve(r ?? { data: null, error: { message: `rpc necunoscut ${fn}` } })
  }
  return {
    rpc: (fn, args) => {
      const t = { then: (ok, ko) => raspuns(fn, args, null).then(ok, ko), range: (a, b) => ({ then: (ok, ko) => raspuns(fn, args, [a, b]).then(ok, ko) }) }
      return t
    },
    from: tabel => {
      const q = { tabel, filtre: [], unic: false }
      for (const m of ['select', 'order', 'limit']) q[m] = () => q
      q.eq = (c, v) => { q.filtre.push([c, v]); return q }
      q.maybeSingle = () => { q.unic = true; return q }
      q.then = (ok, ko) => {
        s.cereri.push({ tabel, filtre: q.filtre })
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
if (!JSDOM) console.warn(`[OfertareSemnale.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip

const LIC = { id: 900001, nr_anunt: 'CN-TEST', obiect: 'Obiect de test' }
const DOC_F3_T = 101, DOC_ATR_T = 102, DOC_ATR_T2 = 103
const DOCS = [{ id: DOC_F3_T, licitatie_id: LIC.id, nume_original: 'F3 test.pdf', tip: 'formular', revizie: '-' },
  { id: DOC_ATR_T, licitatie_id: LIC.id, nume_original: 'ATR test.pdf', tip: 'alta', revizie: '-' },
  { id: DOC_ATR_T2, licitatie_id: LIC.id, nume_original: 'ATR lot 2.pdf', tip: 'alta', revizie: '-' }]
const semnal = (id, verdict, extra = {}) => ({ id, licitatie_id: LIC.id, lot_nr: null, obiect_cheie: '*', element: 'teava_pe_dn160', clasa: 'fizica', um_canonica: 'm',
  identitate: '0123456789abcdef', verdict, motiv: null, valoare_a: null, valoare_b: null, valori_b: [], inventar: {}, clarificare_id: null, reaparut_dupa_respingere: false, rezolvare: null, ...extra })
const RANDURI = [
  { semnal: semnal(1, 'diferenta', { motiv: 'A 6.400 m, B 3.995 m (37,6 % > 5 %)', valoare_a: 6400, valoare_b: 3995, clarificare_id: 77, inventar: { document_b: DOC_ATR_T } }), rezolvat: false, actual: true, in_curs: false,
    masuratori: [
      { id: 11, parte: 'a', verificare: 'ok', fel_dovada: 'tabel', document_id: DOC_F3_T, pagina: 12, rand: '14 | Țeavă PE100 DN160 | m | 6.400', celula: '6.400', antet_coloana: 'Cantitate', valoare_text: '6.400', um_text: 'm', valoare: 6400, natura: 'furnizare' },
      { id: 12, parte: 'b', verificare: 'ok', fel_dovada: 'text', document_id: DOC_ATR_T, pagina: 3, fragment: 'în lungime totală de 3.995 m', valoare_text: '3.995', um_text: 'm', valoare: 3995, natura: 'total_lucrare' },
    ] },
  { semnal: semnal(2, 'de_verificat', { element: 'necunoscut', clasa: 'necunoscuta', motiv: 'lot necunoscut', lot_nr: 2 }), rezolvat: false, actual: true, in_curs: false, masuratori: [] },
  { semnal: semnal(3, 'in_regula', { obiect_cheie: 'tronson 1', valoare_a: 250, valoare_b: 250 }), rezolvat: false, actual: false, in_curs: false, masuratori: [] },
  { semnal: semnal(4, 'in_regula', { obiect_cheie: 'tronson 2', valoare_a: 100, valoare_b: 100 }), rezolvat: false, actual: true, in_curs: true, masuratori: [] },
  { semnal: semnal(5, 'diferenta', { obiect_cheie: 'tronson 3', valoare_a: 500, valoare_b: 300, rezolvare: { document_id: 200, revizie: '-', valoare: 500 } }), rezolvat: false, actual: true, in_curs: false, masuratori: [] },
  { semnal: semnal(6, 'neverificat', { obiect_cheie: 'tronson 4', motiv: 'document necitit (ATR lot 2.pdf)', inventar: { documente_necitite: [DOC_ATR_T2] } }), rezolvat: false, actual: true, in_curs: false, masuratori: [] },
]

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.rpc = {}; st.tabele = {}; st.erori = {}; st.cereri = []; vi.restoreAllMocks() })

function stareImplicita({ drept = true, randuri = RANDURI } = {}) {
  st.rpc = {
    fn_ofertare_semnale_lista: (args, range) => ({ data: range && range[0] === 0 ? randuri : [], error: null }),
    fn_ofertare_source_pack_poate_decide: { data: drept, error: null },
  }
  st.tabele = { ofertare_documente_atribuire: DOCS, ofertare_cantitati_setari: [{ licitatie_id: LIC.id, prag: 0.05, plafon_pagini: 200 }],
    ofertare_cantitati_evaluari: [{ id: 9, licitatie_id: LIC.id, stare: 'publicata', creat_la: '2026-11-27T10:00:00Z', inchisa_la: '2026-11-27T10:01:00Z', pagini: { plafon: 200, plafon_atins: true } }] }
}
async function monteaza(props = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const toast = vi.fn()
  await act(async () => { root.render(<OfertareSemnale licitatie={LIC} profile={{ id: 'u1' }} showToast={toast} deschisInitial {...props} />) })
  await act(async () => { for (let i = 0; i < 80; i++) await Promise.resolve() })
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const culoare = hex => { const e = j.window.document.createElement('div'); e.style.color = hex; return e.style.color }
  return { d: j.window.document, toast, culoare, text: () => j.window.document.body.textContent }
}

describe('incarcaSemnale — paginare prin range până la pagina goală (L23)', () => {
  it('trei pagini (1000 + 3 + 0) → 1003 rânduri, 3 cereri; eroarea opreste și se întoarce', async () => {
    const pagini = [Array.from({ length: 1000 }, (_, i) => ({ semnal: { id: i + 1 } })), [{ semnal: { id: 1001 } }, { semnal: { id: 1002 } }, { semnal: { id: 1003 } }], []]
    const cereri = []
    const sb = { rpc: (fn, args) => ({ range: (a, b) => { cereri.push([fn, args.p_licitatie_id, a, b]); return Promise.resolve({ data: pagini.shift(), error: null }) } }) }
    const r = await incarcaSemnale(sb, LIC.id)
    expect(r.error).toBeUndefined(); expect(r.data.length).toBe(1003)
    expect(cereri).toEqual([['fn_ofertare_semnale_lista', LIC.id, 0, 999], ['fn_ofertare_semnale_lista', LIC.id, 1000, 1999], ['fn_ofertare_semnale_lista', LIC.id, 2000, 2999]])
    const sbE = { rpc: () => ({ range: () => Promise.resolve({ data: null, error: { code: '42501', message: 'CM_FARA_DREPT: fara acces la Ofertare' } }) }) }
    expect((await incarcaSemnale(sbE, LIC.id)).error.code).toBe('42501')
    const sbX = { rpc: () => ({ range: () => Promise.resolve({ data: 'nu e listă', error: null }) }) }
    expect((await incarcaSemnale(sbX, LIC.id)).error.message).toMatch(/neașteptat/)
  })
})

dom('ecranul semnalelor (jsdom)', () => {
  it('semnalul „diferență” cu două dovezi, cel „de verificat: lot necunoscut”, „in_regula” istoric fără verde, „se reevaluează”, „de reconfirmat”', async () => {
    stareImplicita()
    const { d, text, culoare } = await monteaza()
    const t = text()
    expect(t).toContain('⚠ diferență: A 6.400 m, B 3.995 m (37,6 % > 5 %)')
    expect(t).toContain('F3 test.pdf p.12, rândul „14 | Țeavă PE100 DN160 | m | 6.400”, coloana „Cantitate” → 6.400 m')
    expect(t).toContain('ATR test.pdf p.3, fragment „în lungime totală de 3.995 m” → 3.995 m')
    expect(t).toContain('? de verificat: lot necunoscut')
    // in_regula istoric: eticheta „rezultat istoric”, verdictul tăiat și gri (nu verde)
    expect(t).toContain('rezultat istoric — sursele s-au schimbat, nereverificat')
    const verdicte = [...d.querySelectorAll('[data-verdict]')]
    const istoric = verdicte.find(e => e.getAttribute('data-semnal') === '3')
    expect(istoric.textContent).toBe('✓ în regulă')
    expect(istoric.style.textDecoration).toContain('line-through')
    expect(istoric.style.color).toBe(culoare(CULORI.gri)); expect(istoric.style.color).not.toBe(culoare(CULORI.verde))
    const actual = verdicte.find(e => e.getAttribute('data-semnal') === '4')
    expect(actual.style.textDecoration).not.toContain('line-through')
    expect(t).toContain('⏳ se reevaluează')
    expect(t).toContain('răspuns revizuit / șters — de reconfirmat')
    // ordinea gravității: diferențele înaintea celor în regulă
    const ids = verdicte.map(e => e.getAttribute('data-semnal'))
    expect(ids).toEqual(['1', '5', '2', '6', '3', '4'])
    // legătura la ciornă și rezumatul
    expect(t).toContain('deschide în ❓ Clarificări')
    expect(t).toMatch(/2 diferențe/); expect(t).toMatch(/1 de verificat/); expect(t).toMatch(/1 neverificat/)
    // plafonul atins din ultima evaluare, documentul necitit cu butonul de decizie
    expect(t).toContain('plafonul de pagini a fost atins')
    expect(t).toContain('ATR lot 2.pdf')
    expect([...d.querySelectorAll('button')].some(b => b.textContent.includes('Nu e sursă cantitativă'))).toBe(true)
  })
  it('eroarea de citire → mesajul fail-closed, fără tabel și fără „0 semnale”', async () => {
    stareImplicita()
    st.rpc.fn_ofertare_semnale_lista = { data: null, error: { code: '42501', message: 'CM_FARA_DREPT: fara acces la Ofertare' } }
    const { d, text } = await monteaza()
    expect(text()).toContain(MESAJ_EROARE); expect(text()).toContain('fara acces la Ofertare')
    expect(d.querySelectorAll('[data-verdict]').length).toBe(0)
    expect(text()).not.toMatch(/0 diferențe|niciun semnal/i)
  })
  it('migrarea neaplicată (42P01 / PGRST202) → „încă neactiv”, nu listă goală', async () => {
    stareImplicita()
    st.rpc.fn_ofertare_semnale_lista = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fn_ofertare_semnale_lista' } }
    const { text } = await monteaza()
    expect(text()).toContain(MESAJ_NEACTIV)
  })
  it('fără drept de decizie → câmpurile setărilor și butonul de salvare dezactivate; cu drept → active', async () => {
    stareImplicita({ drept: false })
    const { d } = await monteaza()
    const inputs = [...d.querySelectorAll('input')]
    expect(inputs.length).toBe(2); for (const i of inputs) expect(i.disabled).toBe(true)
    expect([...d.querySelectorAll('button')].find(b => b.textContent.includes('Salvează')).disabled).toBe(true)
    expect([...d.querySelectorAll('button')].find(b => b.textContent.includes('Nu e sursă cantitativă')).disabled).toBe(true)
    curata.forEach(f => f()); curata = []
    stareImplicita({ drept: true })
    const m2 = await monteaza()
    for (const i of [...m2.d.querySelectorAll('input')]) expect(i.disabled).toBe(false)
    expect([...m2.d.querySelectorAll('button')].find(b => b.textContent.includes('Salvează')).disabled).toBe(false)
  })
  it('dreptul necunoscut (RPC eșuat) = fără drept (fail-closed)', async () => {
    stareImplicita()
    st.rpc.fn_ofertare_source_pack_poate_decide = { data: null, error: { message: 'retea' } }
    const { d } = await monteaza()
    for (const i of [...d.querySelectorAll('input')]) expect(i.disabled).toBe(true)
  })
  it('lista goală (zero semnale) ≠ eroare: mesajul spune că nu există evaluare, nu „în regulă”', async () => {
    stareImplicita({ randuri: [] })
    const { text } = await monteaza()
    expect(text()).toContain('Nicio măsură evaluată încă')
    expect(text()).not.toContain(MESAJ_EROARE)
  })
})
