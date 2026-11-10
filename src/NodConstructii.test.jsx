// Teste de componentă pentru NodConstructii: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS ale cărui
// răspunsuri se eliberează manual (ordinea răspunsurilor e controlată de test). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului: se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import NodConstructii from './NodConstructii.jsx'
import { ziBucuresti } from './lib/izoTeren.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[NodConstructii.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const F8 = ['sapatura', 'egalizare', 'armare_cofrare', 'turnare', 'elevatie', 'decofrare', 'umplutura', 'montaj']
const U1 = '00000000-0000-0000-0000-0000000000a1'
const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const EL = (id, cod, extra = {}) => ({
  id, proiect_id: 1, nod_cod: 'NOD-A', cod, cod_detaliu: 'TEST-C-1', plansa_sursa: 'TEST-C-00', denumire: 'Element ' + cod, tip: 'fundatie', grup: 'rezervoare',
  echipament: null, cantitate: 1, um: 'buc', pozitie: null, certitudine: 'de_confirmat', observatii: null, etape: F8, etape_data: [], etape_de: [], etape_la: [],
  etapa_curenta: 'sapatura', stare: 'activ', motiv: null, ultima_retragere: null, versiune: 1, ...extra,
})

// clientul fals: „serverul” e o hartă de rânduri; RPC-ul se aplică pe server abia când testul îl eliberează ('ok') sau întoarce eroare de rețea
function clientFals({ randuri, drept = true, nume = { data: [{ id: U1, name: 'POPESCU ION' }], error: null } }) {
  const server = new Map(randuri.map(r => [r.id, { ...r }]))
  const st = { rpc: [], rand: [], profiles: [] }
  const interogare = () => {
    const f = { gt: null, lim: 1000, id: null }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { if (c === 'id') f.id = v; return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      maybeSingle: () => {
        const instant = server.has(f.id) ? { ...server.get(f.id) } : null
        const d = amana(); st.rand.push({ id: f.id, ...d })
        return d.p.then(() => ({ data: instant, error: null }))
      },
      then: (res, rej) => Promise.resolve({ data: [...server.values()].filter(r => f.gt == null || r.id > f.gt).sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r })), error: null }).then(res, rej),
    }
    return q
  }
  const client = {
    from: t => (t === 'profiles'
      ? { select: () => ({ in: (_c, ids) => { st.profiles.push(ids); return Promise.resolve(nume) } }) }
      : interogare()),
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: drept, error: null })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      return d.p.then(mod => {
        if (mod === 'eroare') return { data: null, error: { message: 'timeout simulat' } }
        const r = server.get(a.p_id)
        if (r.versiune !== a.p_versiune) return { data: { ok: false, motiv: 'conflict', element: { ...r } }, error: null }
        if (a.p_actiune === 'bifeaza') Object.assign(r, { etape_data: [...r.etape_data, a.p_data], etape_de: [...r.etape_de, U1], etape_la: [...r.etape_la, 'acum'] })
        else Object.assign(r, { etape_data: r.etape_data.slice(0, -1), etape_de: r.etape_de.slice(0, -1), etape_la: r.etape_la.slice(0, -1), ultima_retragere: `${a.p_etapa}: ${a.p_motiv}` })
        r.versiune += 1
        return { data: { ok: true, duplicat: false, element: { ...r } }, error: null }
      })
    },
  }
  return { client, st, server }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true, url: 'https://erp.test/executie?proiect=1&tab=nod' })
  const vechi = { window: globalThis.window, document: globalThis.document, sessionStorage: globalThis.sessionStorage }
  Object.assign(globalThis, { window: j.window, document: j.window.document, sessionStorage: j.window.sessionStorage })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let ceas = 1_000_000_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => ceas)
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<NodConstructii proiectId={1} client={client} />) })
  await asteapta()
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => { demonteaza(); Object.assign(globalThis, vechi) })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = (text, ultim = true) => { const b = butoane().filter(x => x.textContent.includes(text)); const r = ultim ? b.at(-1) : b[0]; if (!r) throw new Error('nu găsesc butonul ' + text); return r }
  const apasa = async el => { ceas += 1000; await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  const deschide = async cod => { await apasa(buton(cod, false)) }
  const inchide = async () => { await apasa(d.querySelector('button[aria-label="Închide"]')) }
  const coduriVizibile = () => butoane().map(b => b.textContent).filter(t => /^[A-Z][A-Z0-9]*-\d/.test(t.trim())).map(t => t.trim().match(/^[A-Z][A-Z0-9]*-\d+/)[0])
  return { d, act, demonteaza, asteapta, apasa, buton, scrie, elibereaza, deschide, inchide, coduriVizibile }
}

dom(numeDom('NodConstructii — listă, filtre, fișă (jsdom + react-dom)'), () => {
  it('lista pe tipuri, procentul pe tip, „Fundații rezervoare” primul filtru; filtrul și „doar nefinalizate”', async () => {
    const { client } = clientFals({ randuri: [
      EL(1, 'F6-1', { etape_data: ['2026-11-01', '2026-11-02'], etape_de: [U1, null], etape_la: ['x', 'y'] }),
      EL(2, 'SPC-1', { grup: 'spc', etape: ['sapatura', 'turnare'], etape_data: ['2026-11-01', '2026-11-01'], etape_de: [U1, U1], etape_la: ['x', 'y'] }),
      EL(3, 'IPB-1', { tip: 'imprejmuire', grup: 'imprejmuire', cantitate: 110, um: 'm', etape: ['trasare', 'montaj'] }),
      EL(4, 'X-1', { stare: 'anulat', motiv: 'import: lipsește' }),
    ] })
    const u = await monteaza(client)
    const t = u.d.body.textContent
    expect(t).toContain('Fundații')                       // grupul pe tip
    expect(t).toContain('Împrejmuire')
    expect(t).toContain('gata 1 din 2')                   // fundații: SPC-1 gata, F6-1 în lucru (anulatul nu intră)
    expect(t).toContain('110 m')
    const chipuri = [...u.d.querySelectorAll('button')].map(b => b.textContent)
    expect(chipuri.findIndex(x => x.includes('Fundații rezervoare'))).toBeLessThan(chipuri.findIndex(x => x.startsWith('Toate')))
    expect(u.coduriVizibile()).toEqual(['F6-1', 'SPC-1', 'IPB-1'])
    await u.apasa(u.buton('Fundații rezervoare'))
    expect(u.coduriVizibile()).toEqual(['F6-1'])
    await u.apasa(u.buton('Toate'))
    await u.act(async () => { u.d.querySelector('input[type="checkbox"]').click() })
    await u.asteapta()
    expect(u.coduriVizibile()).toEqual(['F6-1', 'IPB-1'])
  })

  it('fișa: etapele făcute cu data și cine (inclusiv stadiul din import); bifarea trimite exact etapa următoare și data', async () => {
    const { client, st } = clientFals({ randuri: [EL(1, 'F6-1', { etape_data: ['2026-11-01', '2026-11-02'], etape_de: [U1, null], etape_la: ['x', 'y'] })] })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    const t = u.d.body.textContent
    expect(t).toContain('01.11.2026 · POPESCU ION')
    expect(t).toContain('02.11.2026 · stadiu inițial (din import)')
    await u.apasa(u.buton('Bifează: Armare + cofrare'))
    await u.apasa(u.buton('✓ Confirmă'))
    expect(st.rpc).toHaveLength(1)
    const { p_cheie, ...rest } = st.rpc[0].a
    expect(rest).toEqual({ p_id: 1, p_versiune: 1, p_actiune: 'bifeaza', p_etapa: 'armare_cofrare', p_data: ziBucuresti(), p_motiv: null })
    expect(p_cheie).toMatch(/^[0-9a-f-]{36}$/)
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('Salvat.')
    expect(u.d.body.textContent).toContain('3/8')
  })

  it('retragerea cere motiv și trimite ultima etapă, fără dată', async () => {
    const { client, st } = clientFals({ randuri: [EL(1, 'F6-1', { etape_data: ['2026-11-01'], etape_de: [U1], etape_la: ['x'] })] })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    await u.apasa(u.buton('Retrage: Săpătură'))
    expect(u.buton('Confirmă retragerea').disabled).toBe(true)
    await u.scrie(u.d.querySelector('input[placeholder="ex. bifat din greșeală"]'), 'greșit')
    await u.apasa(u.buton('Confirmă retragerea'))
    const { p_cheie, ...rest } = st.rpc[0].a
    expect(rest).toEqual({ p_id: 1, p_versiune: 1, p_actiune: 'retrage', p_etapa: 'sapatura', p_data: null, p_motiv: 'greșit' })
  })

  it('L05: rezultat necunoscut -> aceeași cerere cu aceeași cheie; formular schimbat -> întâi reconciliere cu serverul', async () => {
    const { client, st } = clientFals({ randuri: [EL(1, 'F6-1')] })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    await u.apasa(u.buton('Bifează: Săpătură'))
    await u.apasa(u.buton('✓ Confirmă'))
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(u.d.body.textContent).toContain('Nu se știe dacă s-a salvat')
    await u.apasa(u.buton('✓ Confirmă'))                                    // formular neschimbat
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)
    await u.elibereaza(st.rpc[1], 'eroare')
    const ieri = (() => { const [a, l, z] = ziBucuresti().split('-').map(Number); return new Date(Date.UTC(a, l - 1, z - 1, 12)).toISOString().slice(0, 10) })()
    await u.scrie(u.d.querySelector('input[type="date"]'), ieri)
    await u.apasa(u.buton('✓ Confirmă'))                                    // formular schimbat: nu o cerere nouă, ci reconciliere
    expect(st.rpc).toHaveLength(2)
    expect(st.rand).toHaveLength(1)
    await u.elibereaza(st.rand[0], undefined)
    expect(u.d.body.textContent).toContain('am adus starea reală')
    await u.apasa(u.buton('✓ Confirmă'))                                    // după reconciliere: intenție nouă, cheie nouă
    expect(st.rpc).toHaveLength(3)
    expect(st.rpc[2].a.p_cheie).not.toBe(st.rpc[0].a.p_cheie)
    expect(st.rpc[2].a.p_data).toBe(ieri)
  })

  it('conflict (alt utilizator a bifat între timp): mesaj și starea actuală adusă', async () => {
    const { client, st, server } = clientFals({ randuri: [EL(1, 'F6-1')] })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    await u.apasa(u.buton('Bifează: Săpătură'))
    await u.apasa(u.buton('✓ Confirmă'))
    Object.assign(server.get(1), { versiune: 2, etape_data: ['2026-11-01'], etape_de: [U1], etape_la: ['x'] })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('schimbat între timp')
    expect(u.d.body.textContent).toContain('1/8')
  })

  it('fără drept de scriere: fișa doar se citește; eroarea la nume se arată (nu devine „nimeni”)', async () => {
    const { client } = clientFals({ randuri: [EL(1, 'F6-1', { etape_data: ['2026-11-01'], etape_de: [U1], etape_la: ['x'] })], drept: false,
      nume: { data: null, error: { message: 'permission denied' } } })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    const t = u.d.body.textContent
    expect(t).toContain('Doar citire')
    expect(t).not.toContain('Bifează')
    expect(t).toContain('01.11.2026 · nume indisponibil')
  })

  it('demontarea în timpul salvării: răspunsul ulterior nu mai programează nimic', async () => {
    const { client, st } = clientFals({ randuri: [EL(1, 'F6-1')] })
    const u = await monteaza(client)
    await u.deschide('F6-1')
    await u.apasa(u.buton('Bifează: Săpătură'))
    await u.apasa(u.buton('✓ Confirmă'))
    u.demonteaza()
    const timere = vi.spyOn(globalThis, 'setTimeout')
    const erori = vi.spyOn(console, 'error')
    await u.act(async () => { st.rpc[0].res('ok'); for (let i = 0; i < 30; i++) await Promise.resolve() })
    expect(timere.mock.calls.filter(([, ms]) => ms === 700)).toEqual([])
    expect(erori).not.toHaveBeenCalled()
  })
})
