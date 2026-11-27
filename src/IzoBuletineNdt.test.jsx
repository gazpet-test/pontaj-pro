// Teste de componentă pentru IzoBuletineNdt (Izometrie → Buletine NDT): componenta reală montată cu react-dom în jsdom,
// cu un client Supabase FALS (tabele în memorie, RPC-uri, Storage și funcția edge simulate). Fără rețea, date inventate.
// jsdom nu e dependență a proiectului (ca la src/IzoBandaTronson.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

const st = vi.hoisted(() => ({ tabele: {}, cereri: [], rpc: [], rpcRaspuns: {}, urcari: [], edge: null, edgeApeluri: [] }))
vi.mock('./lib/supabase.js', () => {
  const potriveste = (r, f) => f.eq.every(([c, v]) => r[c] === v) && f.neq.every(([c, v]) => r[c] !== v)
    && (!f.in || f.in[1].includes(r[f.in[0]])) && (f.gt == null || r.id > f.gt)
  return {
    supabase: {
      from: tabel => {
        const f = { eq: [], neq: [], in: null, gt: null, lim: Infinity, head: false, single: false }
        const rezultat = () => {
          st.cereri.push(tabel)
          const rows = (st.tabele[tabel] || []).filter(r => potriveste(r, f)).sort((a, b) => a.id - b.id).slice(0, Math.min(f.lim, 1000)).map(r => ({ ...r }))
          if (f.head) return { count: rows.length, data: null, error: null }
          if (f.single) return { data: rows[0] || null, error: null }
          return { data: rows, error: null }
        }
        const q = {
          select: (_c, o) => { if (o?.head) f.head = true; return q },
          order: () => q,
          eq: (c, v) => { f.eq.push([c, v]); return q },
          neq: (c, v) => { f.neq.push([c, v]); return q },
          in: (c, v) => { f.in = [c, v]; return q },
          gt: (_c, v) => { f.gt = v; return q },
          limit: n => { f.lim = n; return q },
          maybeSingle: () => { f.single = true; return q },
          then: (res, rej) => Promise.resolve(rezultat()).then(res, rej),
        }
        return q
      },
      rpc: (nume, args) => {
        st.rpc.push([nume, args])
        const r = st.rpcRaspuns[nume]
        const v = typeof r === 'function' ? r(args) : r ?? { data: null, error: null }
        return Promise.resolve({ status: 200, ...v })
      },
      storage: {
        from: () => ({
          upload: (p, file, o) => { st.urcari.push([p, o]); return Promise.resolve({ data: { path: p }, error: null }) },
          createSignedUrl: p => Promise.resolve({ data: { signedUrl: `https://fals.invalid/${p}` }, error: null }),
        }),
      },
      functions: {
        invoke: (nume, o) => { st.edgeApeluri.push([nume, o.body]); return Promise.resolve(st.edge || { data: null, error: { name: 'FunctionsHttpError', context: { status: 404 } } }) },
      },
    },
  }
})
import IzoBuletineNdt from './IzoBuletineNdt.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[IzoBuletineNdt.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

// date inventate: proiectul 1, tronsonul 50 = T12, un pachet cu suduri T12S125–T12S127
const TRONSON = { id: 50, proiect_id: 1, cod: 'T12' }
const BUL = (id, o = {}) => ({ id, proiect_id: 1, tronson_id: 50, metoda: 'PA-UT', numar: `40${id}`, data_buletin: '2026-10-28', firma_citita: null,
  fisier_path: `1/50/0f8fad5b-d9cb-469f-a165-70867728950${id}.pdf`, fisier_nume: 'b.pdf', fisier_sha256: 'a'.repeat(64), stare: 'ciorna', fortat_motiv: null,
  versiune: 1, incarcat_de: 'u1', incarcat_la: '2026-11-27T10:00:00Z', confirmat_de: null, confirmat_la: null, anulat_de: null, anulat_la: null, anulat_motiv: null, ...o })
const TABELE = () => ({
  sud_buletine: [BUL(1), BUL(2, { metoda: 'PM', stare: 'confirmat', confirmat_de: 'u1', confirmat_la: '2026-11-27T11:00:00Z' })],
  sud_buletin_randuri: [{ id: 10, buletin_id: 2, ordine: 1, cod_raw: 'T12S125', stare_cod: 'ok', motiv_cod: null, cheie: 'T12S125', tronson_nr: 12, nr: 125, sufix: '', refacuta: false, rezultat: 'acceptat', data_inspectie: '2026-10-20' }],
  sud_suduri_eliminate: [],
  sud_metode_proiect: [{ id: 1, proiect_id: 1, metode: ['PA-UT'] }],
  profiles: [{ id: 'u1', name: 'POPESCU ION' }],
  executie_pachete_lansare: [{ id: 7, tronson_id: 50 }],
  executie_tevi: [125, 126, 127].map((n, i) => ({ id: 100 + i, pachet_id: 7, tip_rand: 'teava', sudura_cod: `T12S${n}` })),
})

const curata = []
afterEach(() => { while (curata.length) curata.pop()() })

async function monteaza({ scriere = true, rpc = {}, edge = null } = {}) {
  st.tabele = TABELE(); st.cereri = []; st.rpc = []; st.urcari = []; st.edgeApeluri = []; st.edge = edge
  st.rpcRaspuns = { fn_sud_drept: { data: scriere, error: null }, ...rpc }
  const j = new JSDOM('<!doctype html><div id="r"></div>')
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(j.window.document.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<IzoBuletineNdt proiectId={1} tronsoane={[TRONSON]} initialTronsonId={50} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const d = j.window.document
  const text = () => d.body.textContent
  const buton = t => [...d.querySelectorAll('button')].find(b => b.textContent.includes(t))
  const click = async el => { await act(async () => { el.click() }); await asteapta() }
  const scrie = async (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? j.window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? j.window.HTMLSelectElement.prototype : j.window.HTMLInputElement.prototype
    await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const randBuletin = nr => [...d.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(nr))
  return { d, j, text, buton, click, scrie, randBuletin, asteapta, act }
}

dom(numeDom('IzoBuletineNdt — lista și drepturile'), () => {
  it('lista buletinelor tronsonului, cu stare, rânduri și cine a încărcat; fără drept nu apare „Încarcă”', async () => {
    const e = await monteaza({ scriere: false })
    expect(e.text()).toContain('401')
    expect(e.text()).toContain('402')
    expect(e.randBuletin('402').textContent).toContain('confirmat')
    expect(e.randBuletin('402').textContent).toContain('POPESCU ION')
    expect(e.buton('Încarcă buletin')).toBeUndefined()
    expect(e.text()).toContain('Doar citire')
    expect(st.rpc[0]).toEqual(['fn_sud_drept', { p_proiect: 1, p_nivel: 'scriere' }])
  })
  it('filtrul pe metodă', async () => {
    const e = await monteaza()
    await e.scrie(e.d.querySelector('[aria-label="Filtru metodă"]'), 'PM')
    expect(e.randBuletin('401')).toBeUndefined()
    expect(e.randBuletin('402')).toBeTruthy()
  })
})

dom(numeDom('IzoBuletineNdt — confirmarea'), () => {
  it('lipire din Excel → verificări pe rând → confirmă cu versiunea citită și rândurile exacte', async () => {
    const e = await monteaza({ rpc: { fn_sud_buletin_confirma: { data: 2, error: null } } })
    await e.click(e.randBuletin('401'))
    expect(e.d.querySelector('iframe').getAttribute('src')).toContain('1/50/')
    await e.click(e.buton('Lipește din Excel'))
    await e.scrie(e.d.querySelector('textarea'), 'T12S126\tacceptat\t28.10.2026\nT12S999\trespins\t28.10.2026\t1\t2\t3\t\t0,5\tfisura')
    await e.click(e.buton('Adaugă rândurile'))
    expect(e.text()).toContain('Sudura T12S999 nu există în pachetele tronsonului.')
    expect(e.text()).toContain('ultimul rezultat PA-UT e „respins”')
    expect(e.text()).toContain('n-are încă buletin PM')
    // avertismentele cer bifa „am verificat”
    await e.click(e.buton('Confirmă 2 rânduri'))
    expect(st.rpc.find(r => r[0] === 'fn_sud_buletin_confirma')).toBeUndefined()
    await e.click(e.d.querySelector('input[type="checkbox"]:not([disabled])'))
    await e.click(e.buton('Confirmă 2 rânduri'))
    const c = st.rpc.find(r => r[0] === 'fn_sud_buletin_confirma')
    expect(c[1]).toEqual({ p_id: 1, p_versiune: 1, p_randuri: [
      { cod_raw: 'T12S126', rezultat: 'acceptat', data_inspectie: '2026-10-28', start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, observatii: null },
      { cod_raw: 'T12S999', rezultat: 'respins', data_inspectie: '2026-10-28', start_mm: 1, end_mm: 2, lungime_mm: 3, inaltime_mm: null, adancime_mm: 0.5, observatii: 'fisura' },
    ] })
  })
  it('40001 la confirmare: mesaj de reîncărcare, lista se recitește, rândurile rămân', async () => {
    const e = await monteaza({ rpc: { fn_sud_buletin_confirma: { data: null, error: { code: '40001', message: 'sud: buletinul s-a schimbat intre timp; reincarca' } } } })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('+ Rând'))
    const inp = e.d.querySelectorAll('input[aria-label$="rând 1"]')
    await e.scrie(inp[0], 'T12S125')
    await e.scrie(inp[1], 'acceptat')
    await e.scrie(inp[2], '28.10.2026')
    const citiriInainte = st.cereri.filter(t => t === 'sud_buletine').length
    await e.click(e.buton('Confirmă 1 rânduri'))
    expect(e.text()).toContain('Buletinul s-a schimbat între timp')
    expect(st.cereri.filter(t => t === 'sud_buletine').length).toBeGreaterThan(citiriInainte)
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S125')
  })
  it('funcția edge nepublicată: mesaj clar, introducerea manuală rămâne', async () => {
    const e = await monteaza()
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri).toEqual([['izo-ndt-citeste', { buletin_id: 1, model: 'principal' }]])
    expect(e.text()).toContain('nu e publicată încă')
    expect(e.buton('+ Rând')).toBeTruthy()
  })
  it('citirea AI precompletează tabelul; „Citește din nou” compară și cere alegerea pe rândul diferit', async () => {
    const citire = (rez) => ({ data: { ok: true, citire: { antet: { numar: '401', data: '2026-10-28', nr_randuri_tiparit: 1 }, randuri: [{ cod_raw: 'T12S126', rezultat: rez, data_inspectie: '2026-10-28' }], incerte: [] } }, error: null })
    const e = await monteaza({ edge: citire('ACCEPTED') })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S126')
    st.edge = citire('REJECTED')
    await e.click(e.buton('Citește din nou cu alt model'))
    expect(st.edgeApeluri[1]).toEqual(['izo-ndt-citeste', { buletin_id: 1, model: 'alternativ' }])
    expect(e.text()).toContain('alege varianta corectă')
    expect(e.buton('Confirmă 1 rânduri').disabled).toBe(true)
    const radio = [...e.d.querySelectorAll('input[type="radio"]')]
    await e.click(radio[1])
    await e.click(e.buton('Aplică alegerile'))
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[1].value).toBe('REJECTED')
  })
})

dom(numeDom('IzoBuletineNdt — încărcarea'), () => {
  it('buletin_deja_incarcat → „încarcă oricum” cu motiv, pe același fișier urcat (fără a doua urcare)', async () => {
    let apel = 0
    const e = await monteaza({ rpc: { fn_sud_buletin_incarca: () => (++apel === 1 ? { data: null, error: { code: '23505', message: 'sud: buletin_deja_incarcat:1' } } : { data: 3, error: null }) } })
    await e.click(e.buton('Încarcă buletin'))
    const fisier = new File([new TextEncoder().encode('%PDF-1.7 test')], 'buletin.pdf', { type: 'application/pdf' })
    const inp = e.d.querySelector('input[type="file"]')
    Object.defineProperty(inp, 'files', { value: [fisier] })
    await e.act(async () => { inp.dispatchEvent(new e.j.window.Event('change', { bubbles: true })) })
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5))
    await e.asteapta()
    expect(e.text()).toContain('amprentă')
    await e.scrie(e.d.querySelectorAll('select')[3], 'PA-UT')
    const campuri = [...e.d.querySelectorAll('input:not([type])')]
    await e.scrie(campuri[0], '401')
    await e.scrie(campuri[1], '28.10.2026')
    await e.click([...e.d.querySelectorAll('button')].find(b => b.textContent === 'Încarcă'))
    expect(st.urcari).toHaveLength(1)
    expect(st.urcari[0][0]).toMatch(/^1\/50\/[0-9a-f-]{36}\.pdf$/)
    expect(e.text()).toContain('deja încărcat pe tronson (#1)')
    expect(e.text()).toContain('Poți încărca oricum')
    // fără motiv nu pleacă a doua cerere
    await e.click(e.buton('Încarcă oricum'))
    expect(st.rpc.filter(r => r[0] === 'fn_sud_buletin_incarca')).toHaveLength(1)
    expect(e.text()).toContain('Motivul e obligatoriu')
    const motiv = [...e.d.querySelectorAll('label')].find(l => l.textContent.startsWith('Motivul (obligatoriu)')).querySelector('input')
    await e.scrie(motiv, 'alt laborator')
    await e.click(e.buton('Încarcă oricum'))
    expect(st.urcari).toHaveLength(1)
    const inc = st.rpc.filter(r => r[0] === 'fn_sud_buletin_incarca')
    expect(inc).toHaveLength(2)
    expect(inc[1][1]).toMatchObject({ p_tronson: 50, p_metoda: 'PA-UT', p_numar: '401', p_data: '2026-10-28', p_fisier_path: st.urcari[0][0], p_forteaza_motiv: 'alt laborator', p_citiri: null })
    expect(inc[1][1].p_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(inc[0][1].p_forteaza_motiv).toBeNull()
  })
})
