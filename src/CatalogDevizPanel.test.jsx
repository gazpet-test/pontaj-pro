// Teste pentru CatalogDevizPanel (Rest de decontat PR1 r4, review #1158 P1): după ce oferta unui proiect e CONFIRMATĂ în „Rest de decontat”, baza
// de date refuză rescrierea ofertei din catalogul vechi. Ecranul trebuie (1) să verifice rezultatul DELETE-ului și să se OPREASCĂ la refuz, fără
// INSERT-ul care dubla baza (reproducerea review-ului: 120 → 220), (2) să arate mesajul BD în clar, (3) să lase calea legitimă (proiect fără
// ofertă confirmată) neschimbată. Componenta reală montată cu react-dom în jsdom, client Supabase FALS (înregistrează cererile în ordine), parserul
// de deviz FALS (articole fixe). jsdom nu e dependență a proiectului (ca la src/UscareConducta.test.jsx): fără el suita de ecran e SĂRITĂ VIZIBIL;
// explicarea erorii se testează și fără DOM. Date SINTETICE, fără rețea.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// clientul fals: fiecare cerere pe proiect_articole se înregistrează ({op, filtre, rows}); răspunsurile se setează per test
const st = vi.hoisted(() => ({ cereri: [], articole: [], raspuns: { delete: { error: null }, insert: { error: null } } }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from: tabel => {
      const q = { tabel, op: 'select', filtre: [], rows: null }
      q.select = () => { q.op = 'select'; return q }
      q.delete = () => { q.op = 'delete'; return q }
      q.insert = rows => { q.op = 'insert'; q.rows = rows; return q }
      q.eq = (c, v) => { q.filtre.push([c, v]); return q }
      q.order = () => q
      q.then = (res, rej) => {
        st.cereri.push({ op: q.op, filtre: q.filtre, rows: q.rows })
        const r = q.op === 'select' ? { data: st.articole.map(a => ({ ...a })), error: null } : { ...st.raspuns[q.op] }
        return Promise.resolve(r).then(res, rej)
      }
      return q
    },
  },
}))
const ARTICOL = { obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'D1', deviz_nume: 'Montaj', nr: '1', cod: 'A100', denumire: 'Conducta', um: 'M', cantitate: 100, valoare: 10000 }
vi.mock('./devizParser.js', () => ({ parseDeviz: async () => [{ ...ARTICOL }] }))
import CatalogDevizPanel, { explicaEroareImport } from './CatalogDevizPanel.jsx'

// mesajele BD, scrise de mână ca în migrarea 20270105a (garda proiect_articole), nu luate din cod (L25)
const REFUZ_DELETE = { code: '42501', message: 'rest_decontat: oferta proiectului 4 e confirmata; randurile ofertei nu se mai sterg direct (importul ofertei se face din Rest de decontat)' }
const REFUZ_INSERT = { code: '42501', message: 'rest_decontat: oferta proiectului 4 e confirmata; importul ofertei se face din Rest de decontat (fn_rest_decontat_confirma_baza), nu din catalogul vechi' }
const OCUPAT = { code: '55P03', message: 'rest_decontat: oferta proiectului 4 se confirma chiar acum (Rest de decontat); reincearca' }
const RLS = { code: '42501', message: 'new row violates row-level security policy for table "proiect_articole"' }

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[CatalogDevizPanel.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

describe('explicaEroareImport: refuzul BD ajunge în clar la utilizator', () => {
  it('refuzul gărzii (oferta confirmată) → mesaj clar + mesajul BD; nu se continuă', () => {
    const m = explicaEroareImport(REFUZ_DELETE, 'Eroare import')
    expect(m).toMatch(/^Eroare import refuzat: oferta acestui proiect e confirmată în „Rest de decontat”/)
    expect(m).toContain('Nimic nu s-a schimbat')
    expect(m).toContain(REFUZ_DELETE.message)
  })
  it('55P03 (oferta se confirmă chiar acum) → „reîncearcă”', () => {
    expect(explicaEroareImport(OCUPAT, 'Eroare import')).toMatch(/se confirmă chiar acum.*reîncearcă/)
  })
  it('alt 42501 (RLS, fără „rest_decontat”) și erorile obișnuite rămân cum vin', () => {
    expect(explicaEroareImport(RLS, 'Eroare import')).toBe('Eroare import: ' + RLS.message)
    expect(explicaEroareImport(new Error('Failed to fetch'), 'Eroare import act')).toBe('Eroare import act: Failed to fetch')
    expect(explicaEroareImport('text brut', 'Eroare import')).toBe('Eroare import: text brut')
  })
})

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; st.cereri = []; st.articole = []; st.raspuns = { delete: { error: null }, insert: { error: null } }; vi.restoreAllMocks() })

async function monteaza(proiectId = 4) {
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
  const toast = vi.fn()
  await act(async () => { root.render(<CatalogDevizPanel proiectId={proiectId} showToast={toast} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  // alegerea unui fișier în input-ul de tip file al unui buton (0 = „Deviz inițial”, 1 = „Act adițional”)
  const importa = async (i = 0) => {
    const input = d.querySelectorAll('input[type="file"]')[i]
    Object.defineProperty(input, 'files', { value: [new j.window.File(['x'], 'F3.docx')], configurable: true })
    await act(async () => { input.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  return { d, toast, importa, asteapta }
}
const ops = () => st.cereri.map(c => c.op)

dom(numeDom('CatalogDevizPanel: importul ofertei față de refuzurile BD'), () => {
  it('DELETE refuzat (oferta confirmată) → importul se OPREȘTE, fără INSERT; mesajul BD în clar', async () => {
    st.raspuns.delete = { error: REFUZ_DELETE }
    const { toast, importa } = await monteaza()
    await importa(0)
    expect(ops()).toEqual(['select', 'delete'])   // nicio cerere insert după DELETE-ul refuzat (reproducerea review-ului: 120 → 220 nu se mai poate)
    expect(toast).toHaveBeenCalledTimes(1)
    const [mesaj, tip] = toast.mock.calls[0]
    expect(tip).toBe('error')
    expect(mesaj).toMatch(/oferta acestui proiect e confirmată în „Rest de decontat”/)
    expect(mesaj).toContain(REFUZ_DELETE.message)
  })
  it('INSERT refuzat după un DELETE acceptat → mesajul BD în clar, fără toast de succes', async () => {
    st.raspuns.insert = { error: REFUZ_INSERT }
    const { toast, importa } = await monteaza()
    await importa(0)
    expect(ops()).toEqual(['select', 'delete', 'insert'])
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][1]).toBe('error')
    expect(toast.mock.calls[0][0]).toMatch(/importul ofertei .* se face de acolo, nu din catalog/)
    expect(toast.mock.calls[0][0]).toContain(REFUZ_INSERT.message)
  })
  it('calea legitimă (proiect fără ofertă confirmată): DELETE + INSERT cu sursa contract_initial, toast de succes, catalogul reîncărcat', async () => {
    const { toast, importa } = await monteaza(7)
    await importa(0)
    expect(ops()).toEqual(['select', 'delete', 'insert', 'select'])
    const del = st.cereri[1], ins = st.cereri[2]
    expect(del.filtre).toEqual([['proiect_id', 7], ['sursa', 'contract_initial']])
    expect(ins.rows).toHaveLength(1)
    expect(ins.rows[0]).toMatchObject({ proiect_id: 7, sursa: 'contract_initial', act_nr: null, cod: 'A100', cantitate: 100, valoare: 10000 })
    expect(toast).toHaveBeenCalledWith('✓ 1 articole — contract inițial', 'success')
  })
  it('„Act adițional”: DELETE-ul refuzat oprește importul actului la fel', async () => {
    st.raspuns.delete = { error: REFUZ_DELETE }
    const { toast, importa, d } = await monteaza()
    d.defaultView.prompt = () => '2'
    globalThis.window.prompt = () => '2'
    await importa(1)
    expect(ops()).toEqual(['select', 'delete'])
    expect(toast).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls[0][0]).toMatch(/^Eroare import act refuzat: oferta acestui proiect e confirmată/)
  })
  it('rândurile retrase (activ = false) nu se afișează; oferta confirmată e etichetată', async () => {
    st.articole = [
      { id: 1, proiect_id: 4, obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'D1', nr: '1', cod: 'A100', denumire: 'vechi retras', um: 'M', cantitate: 90, valoare: 9000, sursa: 'contract_initial', activ: false, confirmat_la: null },
      { id: 2, proiect_id: 4, obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'D1', nr: '1', cod: 'A100', denumire: 'confirmat', um: 'M', cantitate: 100, valoare: 10000, sursa: 'contract_initial', activ: true, confirmat_la: '2026-11-21T10:00:00Z' },
      { id: 3, proiect_id: 4, obiect_cod: '0001', obiect_nume: 'TRONSON 1', deviz_cod: 'D1', nr: '2', cod: 'B200', denumire: 'fara coloana activ (inainte de migrare)', um: 'MC', cantitate: 2, valoare: 2000, sursa: 'contract_initial' },
    ]
    const { d } = await monteaza()
    const text = d.body.textContent
    expect(text).toContain('Catalog: 2 articole')
    expect(text).toContain('ofertă confirmată în „Rest de decontat”')
    expect(text).not.toContain('vechi retras')
  })
})
