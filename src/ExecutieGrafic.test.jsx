// Teste de componentă pentru ExecutieGrafic (tab-ul „📅 Grafic” din Execuție): componenta reală montată cu react-dom în jsdom, cu un
// client Supabase FALS ale cărui răspunsuri se pot ține și elibera manual. Datele: graficul SINTETIC din
// test-fixtures/grafic/grafic_sintetic.json (ieșirea importului pe o lucrare fictivă), mapat în rândurile din BD.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import ExecutieGrafic from './ExecutieGrafic.jsx'
import { revizieDinJson, activitatiDinJson } from './executieGraficLogica.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[ExecutieGrafic.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const DOC = JSON.parse(readFileSync(new URL('../test-fixtures/grafic/grafic_sintetic.json', import.meta.url), 'utf8'))
const AZI = '2026-05-15'
const TOATE = ['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.2.1', '1.2.2', '1.2.3', '1.3', '1.3.1', '1.3.2']
const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const rev = (id, extra = {}) => ({ ...revizieDinJson(DOC, { id, importat_la: `2026-11-0${id}T10:00:00+00:00` }), proiect_id: 1, ...extra })
const acts = (revId, sufix = '') => activitatiDinJson(DOC, revId, revId * 1000).map(a => ({ ...a, nume: a.nume + sufix }))

// clientul fals: răspunsul se calculează la cerere; prima pagină a unei citiri (tabel:valoare) poate fi ținută de o poartă
function clientFals({ revizii = [], activitati = {}, erori = {} } = {}) {
  const st = { porti: {}, cereri: [] }
  const interogare = tabel => {
    const f = { col: null, val: null, gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.col = c; f.val = v; return q },
      limit: n => { f.lim = n; return q },
      gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        st.cereri.push({ tabel, ...f })
        const sursa = tabel === 'executie_grafic_revizii' ? revizii.filter(r => r.proiect_id === f.val) : (activitati[f.val] || [])
        const rows = sursa.filter(r => f.gt == null || r.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        const poarta = f.gt == null ? st.porti[`${tabel}:${f.val}`] : null
        return (poarta ? poarta.p : Promise.resolve())
          .then(() => (erori[tabel] ? { data: null, error: erori[tabel] } : { data: rows, error: null })).then(res, rej)
      },
    }
    return q
  }
  return { client: { from: interogare }, st }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

async function monteaza(client, { proiectId = 1 } = {}) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  const randeaza = async p => { await act(async () => { root.render(<ExecutieGrafic proiectId={p} client={client} azi={AZI} />) }); await asteapta() }
  await randeaza(proiectId)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const randuri = () => [...d.querySelectorAll('tr[data-wbs]')].map(tr => tr.getAttribute('data-wbs'))
  const rand = w => d.querySelector(`tr[data-wbs="${w}"]`)
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const buton = text => { const b = [...d.querySelectorAll('button')].find(x => x.textContent.includes(text)); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const alege = async (sel, val) => {
    const set = Object.getOwnPropertyDescriptor(j.window.HTMLSelectElement.prototype, 'value').set
    await act(async () => { set.call(sel, String(val)); sel.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async poarta => { await act(async () => { poarta.res() }); await asteapta() }
  const antete = () => [...d.querySelectorAll('th')].map(t => t.textContent)
  return { d, randuri, rand, apasa, buton, alege, elibereaza, antete, randeaza, text: () => d.body.textContent }
}

dom(numeDom('ExecutieGrafic — afișare (jsdom + react-dom)'), () => {
  it('randează graficul sintetic: ierarhia, depășitele, coloanele de raport, nota valorilor incerte', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true })], activitati: { 1: acts(1) } })
    const u = await monteaza(client)
    expect(u.randuri()).toEqual(TOATE)
    expect(u.rand('1.2.2').getAttribute('data-depasit')).toBe('1')
    expect(u.rand('1.1.1').getAttribute('data-depasit')).toBe('0')
    expect(u.rand('1.3.2').getAttribute('data-depasit')).toBe('0')
    expect(u.rand('1.3.2').getAttribute('data-inactiv')).toBe('1')
    expect(TOATE.filter(w => u.rand(w).getAttribute('data-depasit') === '1')).toEqual(['1.2.2'])
    expect(u.d.querySelector('[data-test="depasite"]').textContent).toBe('1 activitate depășită')
    expect(u.antete()).toEqual(expect.arrayContaining(['WBS', 'Activitate', 'Start', 'Finish', '% realizat', '% plan', '% raport']))
    const t = u.rand('1.2.2').textContent
    expect(t).toContain('Montaj conductă')
    expect(t).toContain('16.03.2026')
    expect(t).toContain('08.05.2026')
    expect(t).toContain('55,25%')
    expect(t).toContain('80%')
    expect(u.d.querySelector('[data-test="incerte"]').textContent).toContain('1 valoare necitibilă în coloanele de raport (% plan / % raport): WBS 1.3.1')
    expect(u.text()).toContain('date la stare: 30.04.2026')
    expect(u.text()).toContain('fișier: grafic_sintetic.xml')
    expect(u.d.querySelectorAll('[data-gantt]')).toHaveLength(11)
  })

  it('plierea la nivel 1–2: comutatorul ascunde și arată copiii; „Restrânge tot” / „Extinde tot”', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true })], activitati: { 1: acts(1) } })
    const u = await monteaza(client)
    expect(u.rand('1.2.1').querySelector('[data-test="comutator"]')).toBeNull()   // nivel 3: fără comutator
    await u.apasa(u.rand('1.2').querySelector('[data-test="comutator"]'))
    expect(u.randuri()).toEqual(['1', '1.1', '1.1.1', '1.1.2', '1.2', '1.3', '1.3.1', '1.3.2'])
    expect(u.d.querySelectorAll('[data-gantt]')).toHaveLength(8)
    await u.apasa(u.rand('1.2').querySelector('[data-test="comutator"]'))
    expect(u.randuri()).toEqual(TOATE)
    await u.apasa(u.buton('Restrânge tot'))
    expect(u.randuri()).toEqual(['1'])
    await u.apasa(u.buton('Extinde tot'))
    expect(u.randuri()).toEqual(TOATE)
  })

  it('„Doar depășite” arată depășitele cu strămoșii lor', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true })], activitati: { 1: acts(1) } })
    const u = await monteaza(client)
    await u.apasa(u.d.querySelector('[data-test="doar-depasite"]'))
    expect(u.randuri()).toEqual(['1', '1.2', '1.2.2'])
    await u.apasa(u.d.querySelector('[data-test="doar-depasite"]'))
    expect(u.randuri()).toEqual(TOATE)
  })

  it('% plan / % raport apar doar dacă revizia are coloanele de raport', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true, camp_pct_plan: null, camp_pct_raportat: null })], activitati: { 1: acts(1) } })
    const u = await monteaza(client)
    expect(u.randuri()).toEqual(TOATE)
    expect(u.antete()).not.toContain('% plan')
    expect(u.antete()).not.toContain('% raport')
    expect(u.antete()).toContain('% realizat')
    expect(u.d.querySelector('[data-test="incerte"]').textContent).toContain('1.3.1')
  })
})

dom(numeDom('ExecutieGrafic — citiri, erori și răspunsuri întârziate'), () => {
  it('L24: schimbarea reviziei cât încă se citește cea veche — răspunsul vechi nu suprascrie', async () => {
    const r1 = rev(1)                                                       // fără „activ”, cu coloanele de raport
    const r2 = rev(2, { activ: true, eticheta: 'Grafic sintetic R2', camp_pct_plan: null, camp_pct_raportat: null, sursa_sha256: 'b'.repeat(64) })
    const { client, st } = clientFals({ revizii: [r1, r2], activitati: { 1: acts(1), 2: acts(2, ' (R2)') } })
    st.porti['executie_grafic_activitati:2'] = amana()
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="revizie"]').value).toBe('2')      // implicit: revizia activă
    expect(u.randuri()).toEqual([])                                          // încă se citește
    await u.alege(u.d.querySelector('[data-test="revizie"]'), 1)
    expect(u.randuri()).toEqual(TOATE)
    await u.elibereaza(st.porti['executie_grafic_activitati:2'])            // abia acum ajunge revizia veche
    expect(u.randuri()).toEqual(TOATE)
    expect(u.text()).not.toContain('(R2)')
    expect(u.antete()).toContain('% raport')
    expect(u.d.querySelector('[data-test="revizie"]').value).toBe('1')
  })

  it('L24: schimbarea proiectului cât încă se citesc reviziile vechiului proiect', async () => {
    const p2 = { ...rev(5, { activ: true, eticheta: 'Proiect 2 R1' }), proiect_id: 2 }
    const { client, st } = clientFals({ revizii: [rev(1, { activ: true }), p2], activitati: { 1: acts(1), 5: acts(5, ' P2') } })
    st.porti['executie_grafic_revizii:1'] = amana()
    const u = await monteaza(client, { proiectId: 1 })
    await u.randeaza(2)
    expect(u.text()).toContain('Proiect 2 R1')
    await u.elibereaza(st.porti['executie_grafic_revizii:1'])
    const optiuni = [...u.d.querySelectorAll('[data-test="revizie"] option')].map(o => o.textContent)
    expect(optiuni).toEqual(['Proiect 2 R1 (activă)'])
    expect(u.rand('1.2.2').textContent).toContain('Montaj conductă P2')
  })

  it('L18: eroarea la citire se arată ca eroare, nu ca „niciun grafic”', async () => {
    const { client } = clientFals({ erori: { executie_grafic_revizii: { code: '57014', message: 'timeout simulat' } } })
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="eroare"]').textContent).toContain('Nu am putut încărca graficul: timeout simulat')
    expect(u.text()).not.toContain('Niciun grafic')
    expect(u.buton('Reîncearcă')).toBeTruthy()
  })

  it('tabelul lipsă (migrarea neaplicată) -> mesaj prietenos, fără „Reîncearcă”', async () => {
    const { client } = clientFals({ erori: { executie_grafic_revizii: { code: 'PGRST205', message: "Could not find the table 'public.executie_grafic_revizii' in the schema cache" } } })
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="eroare"]').textContent).toBe('Graficul de execuție nu e încă activat în baza de date.')
    expect(() => u.buton('Reîncearcă')).toThrow()
  })

  it('zero revizii -> „Niciun grafic importat pentru acest proiect.”', async () => {
    const { client } = clientFals({ revizii: [] })
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="gol"]').textContent).toBe('Niciun grafic importat pentru acest proiect.')
  })

  it('L12: numărul activităților citite ≠ cel al reviziei -> eroare vizibilă, fără tabel', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true, nr_activitati: 12 })], activitati: { 1: acts(1) } })
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="eroare-activitati"]').textContent).toBe('Graficul e incomplet: am citit 11 din 12 activități.')
    expect(u.randuri()).toEqual([])
  })

  it('eroarea la citirea activităților se arată, nu devine tabel gol', async () => {
    const { client } = clientFals({ revizii: [rev(1, { activ: true })], erori: { executie_grafic_activitati: { message: 'Failed to fetch' } } })
    const u = await monteaza(client)
    expect(u.d.querySelector('[data-test="eroare-activitati"]').textContent).toBe('Nu am putut încărca graficul: Failed to fetch')
  })

  it('citirile sunt pe chei (keyset pe id, L23): a doua pagină cere id > ultimul', async () => {
    const { client, st } = clientFals({ revizii: [rev(1, { activ: true })], activitati: { 1: acts(1) } })
    await monteaza(client)
    const a = st.cereri.filter(c => c.tabel === 'executie_grafic_activitati')
    expect(a.map(c => [c.col, c.val, c.gt])).toEqual([['revizie_id', 1, null], ['revizie_id', 1, 1010]])
  })
})
