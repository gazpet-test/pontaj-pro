// Teste de componentă pentru IzoBuletineNdt (Izometrie → Buletine NDT): componenta reală montată cu react-dom în jsdom,
// cu un client Supabase FALS (tabele în memorie, RPC-uri, Storage și funcția edge simulate). Fără rețea, date inventate.
// jsdom nu e dependență a proiectului (ca la src/IzoBandaTronson.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createHash } from 'node:crypto'

const st = vi.hoisted(() => ({ tabele: {}, erori: {}, cereri: [], rpc: [], rpcRaspuns: {}, urcari: [], edge: null, edgeApeluri: [] }))
vi.mock('./lib/supabase.js', () => {
  const potriveste = (r, f) => f.eq.every(([c, v]) => r[c] === v) && f.neq.every(([c, v]) => r[c] !== v)
    && (!f.in || f.in[1].includes(r[f.in[0]])) && (f.gt == null || r.id > f.gt)
  return {
    supabase: {
      from: tabel => {
        const f = { eq: [], neq: [], in: null, gt: null, lim: Infinity, head: false, single: false }
        const rezultat = () => {
          st.cereri.push(tabel)
          if (st.erori[tabel]) return { data: null, error: st.erori[tabel] }
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
        // răspunsul poate fi și o promisiune (amânată de test, ca să se vadă ecranul în timpul cererii)
        return Promise.resolve(typeof r === 'function' ? r(args) : r).then(v => ({ status: 200, ...(v ?? { data: null, error: null }) }))
      },
      storage: {
        from: () => ({
          upload: (p, file, o) => { st.urcari.push([p, o]); return Promise.resolve({ data: { path: p }, error: null }) },
          createSignedUrl: p => Promise.resolve({ data: { signedUrl: `https://fals.invalid/${p}` }, error: null }),
        }),
      },
      functions: {
        invoke: (nume, o) => { st.edgeApeluri.push([nume, o.body]); return Promise.resolve(typeof st.edge === 'function' ? st.edge(o.body) : st.edge || { data: null, error: { name: 'FunctionsHttpError', context: { status: 404 } } }) },
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

async function monteaza({ scriere = true, rpc = {}, edge = null, tronsoane = [TRONSON], tabele = null, onGarda, erori = {}, stocare = {}, stocareRupta = false } = {}) {
  st.tabele = tabele ? tabele(TABELE()) : TABELE(); st.cereri = []; st.rpc = []; st.urcari = []; st.edgeApeluri = []; st.edge = edge; st.erori = erori
  st.rpcRaspuns = { fn_sud_drept: { data: scriere, error: null }, ...rpc }
  // origine proprie (localStorage cere o origine; about:blank n-are): cererile de citire păstrate în browser (PR #1222 r2)
  const j = new JSDOM('<!doctype html><div id="r"></div>', { url: 'https://erp.invalid/' })
  for (const [k, v] of Object.entries(stocare)) j.window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))
  if (stocareRupta) j.window.Storage.prototype.setItem = () => { throw new j.window.DOMException('plin', 'QuotaExceededError') }
  j.window.confirm = vi.fn(() => true)   // jsdom nu are confirm(); testele îl schimbă unde contează
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  const root = createRoot(j.window.document.getElementById('r'))
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 60; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<IzoBuletineNdt proiectId={1} tronsoane={tronsoane} initialTronsonId={50} onGarda={onGarda} />) })
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
  // alege un PDF în panoul de încărcare și așteaptă amprenta (crypto.subtle e asincron în afara microtask-urilor)
  const alegeFisier = async (continut = '%PDF-1.7 test') => {
    const fisier = new File([new TextEncoder().encode(continut)], 'buletin.pdf', { type: 'application/pdf' })
    const inp = d.querySelector('input[type="file"]')
    Object.defineProperty(inp, 'files', { value: [fisier] })
    await act(async () => { inp.dispatchEvent(new j.window.Event('change', { bubbles: true })) })
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 5))
    await asteapta()
  }
  return { d, j, text, buton, click, scrie, randBuletin, asteapta, act, alegeFisier }
}
// o promisiune pe care testul o rezolvă când vrea (răspunsul serverului „în drum”)
const amanat = () => { let rezolva; const p = new Promise(r => { rezolva = r }); return { p, rezolva } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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
    expect(st.edgeApeluri).toEqual([['izo-ndt-citeste', { buletin_id: 1, model: 'principal', cerere: expect.stringMatching(UUID) }]])
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
    expect(st.edgeApeluri[1]).toEqual(['izo-ndt-citeste', { buletin_id: 1, model: 'alternativ', cerere: expect.stringMatching(UUID) }])
    // două intenții (principal, alternativ) = două chei diferite
    expect(st.edgeApeluri[1][1].cerere).not.toBe(st.edgeApeluri[0][1].cerere)
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

// ── runda 2 (Jakarinos #1218 r1): fiecare test pică pe codul din r1 ─────
const CITIRE = (o = {}) => ({ data: { ok: true, citire: { antet: { numar: '401', data: '2026-10-28', nr_randuri_tiparit: 1 }, randuri: [{ cod_raw: 'T12S126', rezultat: 'ACCEPTED', data_inspectie: '2026-10-28' }], incerte: [], ...o } }, error: null })
async function cuRandLipit(e) {
  await e.click(e.randBuletin('401'))
  await e.click(e.buton('Lipește din Excel'))
  await e.scrie(e.d.querySelector('textarea'), 'T12S126\tacceptat\t28.10.2026')
  await e.click(e.buton('Adaugă rândurile'))
}

dom(numeDom('IzoBuletineNdt — runda 2: citirile, blocarea, închiderea'), () => {
  it('P1 :544 — a doua citire parțială / cu pagini necitite: avertismentele rămân după „Aplică alegerile”', async () => {
    const e = await monteaza({ edge: CITIRE() })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(e.text()).not.toContain('Pagini necitite')
    st.edge = CITIRE({ randuri: [{ cod_raw: 'T12S126', rezultat: 'REJECTED', data_inspectie: '2026-10-28' }], partial: true, pagini_necitite: [2], incerte: ['T12S126.rezultat'] })
    await e.click(e.buton('Citește din nou cu alt model'))
    await e.click([...e.d.querySelectorAll('input[type="radio"]')][0])
    await e.click(e.buton('Aplică alegerile'))
    expect(e.buton('Aplică alegerile')).toBeUndefined()
    expect(e.text()).toContain('Pagini necitite: 2.')
    expect(e.text()).toContain('Citirea AI spune că e parțială (a doua citire)')
    expect(e.text()).toContain('1 valori incerte')
    // confirmarea cere bifa, deci avertismentele contează
    await e.click(e.buton('Confirmă 1 rânduri'))
    expect(st.rpc.find(r => r[0] === 'fn_sud_buletin_confirma')).toBeUndefined()
  })

  it('P1 :614 — în timpul confirmării celulele, ștergerea și bifa sunt blocate; se trimite ce se vedea', async () => {
    const raspuns = amanat()
    const e = await monteaza({ rpc: { fn_sud_buletin_confirma: () => raspuns.p } })
    await cuRandLipit(e)
    await e.click(e.buton('Confirmă 1 rânduri'))
    expect(e.buton('Se confirmă')).toBeTruthy()
    const celule = [...e.d.querySelectorAll('input[aria-label$="rând 1"]')]
    expect(celule.length).toBe(9)
    expect(celule.every(x => x.disabled)).toBe(true)
    expect(e.d.querySelector('button[aria-label="Șterge rândul 1"]').disabled).toBe(true)
    expect(e.buton('+ Rând').disabled).toBe(true)
    // chiar dacă evenimentul ajunge (ex. extensie / tastatură), tabelul nu se schimbă
    await e.scrie(celule[1], 'respins')
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[1].value).toBe('acceptat')
    const c = st.rpc.find(r => r[0] === 'fn_sud_buletin_confirma')
    expect(c[1].p_randuri[0].rezultat).toBe('acceptat')
    await e.act(async () => { raspuns.rezolva({ data: null, error: { code: '40001', message: 'sud: buletinul s-a schimbat' } }) })
    await e.asteapta()
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[1].disabled).toBe(false)
  })

  it('P1 :291/:523 (provizoriu) — avertisment „nesalvat” + confirmare la închiderea panoului', async () => {
    const e = await monteaza()
    await cuRandLipit(e)
    expect(e.text()).toContain('nu sunt salvate')
    e.j.window.confirm.mockReturnValue(false)
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).toHaveBeenCalledTimes(1)
    expect(e.d.querySelector('iframe')).toBeTruthy()
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S126')
    // alt buletin din listă: aceeași întrebare
    await e.click(e.randBuletin('402'))
    expect(e.j.window.confirm).toHaveBeenCalledTimes(2)
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S126')
    e.j.window.confirm.mockReturnValue(true)
    await e.click(e.buton('Închide'))
    expect(e.d.querySelector('iframe')).toBeNull()
  })

  it('Jak r2 P1 :257 — garda pentru alt tab din Izometrie: fără citire trece mut, cu citire nesalvată întreabă', async () => {
    let garda = 'nesetat'
    const e = await monteaza({ onGarda: f => { garda = f } })
    expect(typeof garda).toBe('function')
    expect(garda()).toBe(true)
    expect(e.j.window.confirm).not.toHaveBeenCalled()
    await cuRandLipit(e)
    e.j.window.confirm.mockReturnValue(false)
    expect(garda()).toBe(false)
    expect(e.j.window.confirm).toHaveBeenCalledTimes(1)
    e.j.window.confirm.mockReturnValue(true)
    expect(garda()).toBe(true)
    curata.pop()()   // demontarea scoate garda
    expect(garda).toBeNull()
  })

  it('fără nimic în tabel, închiderea nu întreabă', async () => {
    const e = await monteaza()
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).not.toHaveBeenCalled()
    expect(e.d.querySelector('iframe')).toBeNull()
  })

  it('P1 :257 — lipirea „ILIZIBIL<TAB>respins” păstrează rândul, marcat de verificat', async () => {
    const e = await monteaza()
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Lipește din Excel'))
    await e.scrie(e.d.querySelector('textarea'), 'ILIZIBIL\trespins\t28.10.2026\nT12S125\tacceptat\t28.10.2026')
    await e.click(e.buton('Adaugă rândurile'))
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('ILIZIBIL')
    expect(e.d.querySelectorAll('input[aria-label$="rând 2"]')[0].value).toBe('T12S125')
    expect(e.text()).toContain('Adăugate 2 rânduri (1 cu codul fără cifre, marcate de verificat)')
    expect(e.text()).toContain('poate un antet nerecunoscut')
  })
})

dom(numeDom('IzoBuletineNdt — runda 2: încărcarea'), () => {
  async function completeaza(e) {
    await e.alegeFisier()
    await e.scrie(e.d.querySelectorAll('select')[3], 'PA-UT')
    const campuri = [...e.d.querySelectorAll('input:not([type])')]
    await e.scrie(campuri[0], '409')
    await e.scrie(campuri[1], '28.10.2026')
  }

  it('P2 :249/:294 — răspunsul unei încărcări din panoul închis nu închide panoul nou și nu deschide nimic', async () => {
    const raspuns = amanat()
    const e = await monteaza({ rpc: { fn_sud_buletin_incarca: () => raspuns.p } })
    await e.click(e.buton('Încarcă buletin'))
    await completeaza(e)
    await e.click([...e.d.querySelectorAll('button')].find(b => b.textContent === 'Încarcă'))
    expect(e.buton('Se încarcă…')).toBeTruthy()
    await e.click(e.buton('Închide'))
    await e.click(e.buton('Încarcă buletin'))
    expect(e.text()).toContain('Buletin nou pe T12')
    await e.act(async () => { raspuns.rezolva({ data: 1, error: null }) })
    await e.asteapta()
    expect(e.text()).toContain('Buletin nou pe T12')
    expect(e.d.querySelector('iframe')).toBeNull()
  })

  it('P2 :349 — dublura de pe alt tronson: arată tronsonul și „Deschide” trece pe el și deschide buletinul', async () => {
    const sha = createHash('sha256').update('%PDF-1.7 test').digest('hex')
    const T13 = { id: 51, proiect_id: 1, cod: 'T13' }
    const e = await monteaza({ tronsoane: [TRONSON, T13], tabele: t => ({ ...t, sud_buletine: [...t.sud_buletine, BUL(5, { tronson_id: 51, metoda: 'PM', fisier_sha256: sha, fisier_path: '1/51/0f8fad5b-d9cb-469f-a165-708677289505.pdf' })] }) })
    expect(e.randBuletin('405')).toBeUndefined()
    await e.click(e.buton('Încarcă buletin'))
    await e.alegeFisier()
    const leg = [...e.d.querySelectorAll('a')].find(a => a.textContent.includes('405'))
    expect(leg.textContent).toContain('pe tronsonul T13')
    await e.click(leg)
    await e.asteapta()
    expect(e.d.querySelector('[aria-label="Tronson"]').value).toBe('51')
    expect(e.d.querySelector('iframe').getAttribute('src')).toContain('1/51/')
    expect(e.text()).toContain('PM 405')
    expect(e.text()).not.toContain('Buletin nou pe')
  })
})

// ── 20270115b: citirea păstrată pe server (sud_citiri) + cheia cererii ───────────────────────────────
const SALVAT = (cod, rez = 'acceptat') => ({ antet: { firma: null, metoda: 'PA-UT', numar: '401', data: '2026-10-28', tronson: 'T12', nr_randuri_tiparit: 1, partial: false, pagini_necitite: [] },
  randuri: [{ cod_raw: cod, rezultat: rez, data_inspectie: '2026-10-28', start_mm: null, end_mm: null, lungime_mm: null, inaltime_mm: null, adancime_mm: null, observatii: null }],
  incerte: [], partial: false, pagini_necitite: [] })
const CIT = (id, tip, citire, o = {}) => ({ id, buletin_id: 1, proiect_id: 1, tip, model: tip === 'principal' ? 'claude-sonnet-5-5' : 'claude-opus-5-5', stare: 'gata', citire, creat_la: '2026-11-28T09:00:00Z', ...o })
// forma reală a răspunsului edge (handler.ts): cost_usd + cost_cunoscut sunt mereu prezente
const EDGE_OK = (citire, o = {}) => ({ data: { success: true, salvata: true, citire_id: 31, idempotent: false, model: 'claude-sonnet-5-5', citire, cost_usd: 0.0123, cost_cunoscut: true, ...o }, error: null })
const NESALVAT = { salvata: false, citire_id: null, avertisment: 'salvare_neconfirmata' }
const EDGE_ERR = (status, eroare, mesaj = 'm') => () => ({ data: null, error: { name: status ? 'FunctionsHttpError' : 'FunctionsFetchError', message: 'x', context: status ? { status, clone: () => ({ json: () => Promise.resolve({ success: false, eroare, mesaj }) }), json: () => Promise.resolve({}) } : undefined } })

dom(numeDom('IzoBuletineNdt — 20270115b: citirile salvate pe server'), () => {
  it('la deschiderea ciornei se încarcă ultima citire principală salvată; fără corecturi nu e nimic „nesalvat” (închiderea nu întreabă)', async () => {
    const e = await monteaza({ tabele: t => ({ ...t, sud_citiri: [CIT(3, 'principal', SALVAT('T12S125')), CIT(4, 'principal', SALVAT('T12S126')), CIT(5, 'principal', SALVAT('T12S127'), { stare: 'in_curs', citire: null })] }) })
    await e.click(e.randBuletin('401'))
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S126')
    expect(e.text()).toContain('Citirea AI salvată (claude-sonnet-5-5')
    expect(e.text()).toContain('nicio corectură nesalvată')
    expect(e.text()).not.toContain('nu sunt salvate')
    expect(st.edgeApeluri).toEqual([])   // nicio citire nouă, nicio plată
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).not.toHaveBeenCalled()
    expect(e.d.querySelector('iframe')).toBeNull()
  })

  it('o corectură manuală peste citirea salvată = avertisment „corecturile nu sunt salvate” + confirmare la închidere; refăcută = fără', async () => {
    const e = await monteaza({ tabele: t => ({ ...t, sud_citiri: [CIT(3, 'principal', SALVAT('T12S126'))] }) })
    await e.click(e.randBuletin('401'))
    const rez = () => e.d.querySelectorAll('input[aria-label$="rând 1"]')[1]
    await e.scrie(rez(), 'respins')
    expect(e.text()).toContain('Corecturile tale din tabel nu sunt salvate')
    e.j.window.confirm.mockReturnValue(false)
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).toHaveBeenCalledTimes(1)
    expect(e.d.querySelector('iframe')).toBeTruthy()
    await e.scrie(rez(), 'acceptat')
    expect(e.text()).not.toContain('nu sunt salvate')
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).toHaveBeenCalledTimes(1)
    expect(e.d.querySelector('iframe')).toBeNull()
  })

  it('a doua citire salvată, mai nouă decât principala, redeschide comparația; una mai veche nu', async () => {
    const e = await monteaza({ tabele: t => ({ ...t, sud_citiri: [CIT(3, 'principal', SALVAT('T12S126')), CIT(6, 'alternativ', SALVAT('T12S126', 'respins'))] }) })
    await e.click(e.randBuletin('401'))
    expect(e.text()).toContain('A doua citire salvată e deschisă pentru comparație')
    expect(e.buton('Aplică alegerile')).toBeTruthy()
    const v = await monteaza({ tabele: t => ({ ...t, sud_citiri: [CIT(2, 'alternativ', SALVAT('T12S126', 'respins')), CIT(3, 'principal', SALVAT('T12S126'))] }) })
    await v.click(v.randBuletin('401'))
    expect(v.buton('Aplică alegerile')).toBeUndefined()
    expect(v.d.querySelectorAll('input[aria-label$="rând 1"]')[1].value).toBe('acceptat')
  })

  it('citirea salvărilor eșuată = eroare vizibilă (nu „nicio citire”); introducerea manuală rămâne', async () => {
    const e = await monteaza({ erori: { sud_citiri: { code: '42P01', message: 'relation "public.sud_citiri" does not exist' } } })
    await e.click(e.randBuletin('401'))
    expect(e.text()).toContain('Citirile AI salvate nu s-au putut citi')
    expect(e.buton('+ Rând')).toBeTruthy()
  })

  it('citire nouă salvată de server: fără avertisment; nesalvată (salvata ≠ true): avertismentul rămâne și închiderea întreabă', async () => {
    const e = await monteaza({ edge: EDGE_OK(SALVAT('T12S126')) })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(e.d.querySelectorAll('input[aria-label$="rând 1"]')[0].value).toBe('T12S126')
    expect(e.text()).toContain('nicio corectură nesalvată')
    await e.click(e.buton('Închide'))
    expect(e.j.window.confirm).not.toHaveBeenCalled()
    const n = await monteaza({ edge: EDGE_OK(SALVAT('T12S126'), NESALVAT) })
    await n.click(n.randBuletin('401'))
    await n.click(n.buton('Citește cu AI'))
    expect(n.text()).toContain('serverul NU a confirmat salvarea')
    expect(n.text()).toContain('nu sunt salvate')
    n.j.window.confirm.mockReturnValue(false)
    await n.click(n.buton('Închide'))
    expect(n.j.window.confirm).toHaveBeenCalledTimes(1)
  })

  it('L05: după un răspuns necunoscut (rețea / 5xx / în lucru) apăsarea următoare trimite ACEEAȘI cheie; după un rezultat cert, cheie nouă', async () => {
    const e = await monteaza({ edge: EDGE_ERR(0) })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(e.text()).toContain('se reia ACEEAȘI cerere')
    st.edge = EDGE_ERR(409, 'citire_in_curs', 'O citire e în lucru.')
    await e.click(e.buton('Citește cu AI'))
    expect(e.text()).toContain('nu se plătește de două ori')
    st.edge = EDGE_OK(SALVAT('T12S126'), { idempotent: true })
    await e.click(e.buton('Citește cu AI'))
    expect(e.text()).toContain('fără o nouă plată')
    const k = st.edgeApeluri.map(a => a[1].cerere)
    expect(k[0]).toMatch(UUID); expect(k[1]).toBe(k[0]); expect(k[2]).toBe(k[0])
    // după citirea certă: o apăsare nouă = intenție nouă
    st.edge = EDGE_ERR(429, 'prea_multe_citiri', 'maxim 5')
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri[3][1].cerere).not.toBe(k[0])
    expect(e.text()).toContain('maxim 5')
    // refuzul cert scoate și el cheia
    st.edge = EDGE_OK(SALVAT('T12S126'))
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri[4][1].cerere).not.toBe(st.edgeApeluri[3][1].cerere)
  })
})

// ── review PR #1222 r1 P1: cheia cererii nu se pierde după o salvare neconfirmată ───────────────────────────────
// Pe r1 aceste teste pică: răspunsul 200 cu salvata:false era clasificat „ok” și cheia se ștergea (reprodus de Jakarinos), iar la
// redeschidere se încărcau doar rândurile „gata”.
const PREF = 'izoNdtCitire:'
const KP = '0b8f7a32-5c1d-4e2f-9a6b-1c2d3e4f5a6b'
const intrari = e => {
  const s = e.j.window.localStorage, out = []
  for (let i = 0; i < s.length; i++) { const k = s.key(i); if (k.startsWith(PREF)) out.push(JSON.parse(s.getItem(k))) }
  return out
}
const salvari = () => st.rpc.filter(r => r[0] === 'fn_sud_citire_salveaza')
const rand1 = e => e.d.querySelectorAll('input[aria-label$="rând 1"]')[0]?.value

dom(numeDom('IzoBuletineNdt — PR #1222 r2: cheia păstrată și reluarea salvării'), () => {
  it('200 cu salvata:false: cheia + citirea rămân (și în browser); „Citește” nu mai plătește; «Reia salvarea» salvează cu ACEEAȘI cheie, fără apel AI', async () => {
    const e = await monteaza({ edge: EDGE_OK(SALVAT('T12S126'), NESALVAT), rpc: { fn_sud_citire_salveaza: { data: 31, error: null } } })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    const cheie = st.edgeApeluri[0][1].cerere
    expect(cheie).toMatch(UUID)
    expect(intrari(e)).toEqual([expect.objectContaining({ cerere: cheie, buletin_id: 1, tip: 'principal', faza: 'nesalvata',
      raspuns: { citire: SALVAT('T12S126'), cost_usd: 0.0123, cost_cunoscut: true, model: 'claude-sonnet-5-5' } })])
    expect(e.text()).toContain('Citire nesalvată')
    expect(e.text()).toContain('E păstrată în acest browser')
    // o nouă apăsare pe „Citește” NU pornește un apel plătit cât citirea nesalvată e păstrată
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri).toHaveLength(1)
    expect(e.text()).toContain('apasă «Reia salvarea»')
    await e.click(e.buton('Reia salvarea'))
    expect(salvari()).toEqual([['fn_sud_citire_salveaza', { p_cheie: cheie, p_citire: SALVAT('T12S126'), p_cost_usd: 0.0123, p_cost_cunoscut: true, p_eroare: null }]])
    expect(st.edgeApeluri).toHaveLength(1)
    expect(e.text()).toContain('salvată pe server (#31)')
    expect(e.text()).toContain('nicio corectură nesalvată')
    expect(e.buton('Reia salvarea')).toBeUndefined()
    expect(intrari(e)).toEqual([])
    // intenția s-a încheiat: o citire nouă = cheie nouă
    st.edge = EDGE_OK(SALVAT('T12S126'))
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri[1][1].cerere).not.toBe(cheie)
    expect(intrari(e)).toEqual([])
  })

  it('reluarea cu rezultat necunoscut (rețea, 42501) păstrează cheia și citirea; 55000 (încheiată altfel) o scoate, cu mesaj; rândurile rămân', async () => {
    const e = await monteaza({ edge: EDGE_OK(SALVAT('T12S126'), NESALVAT), rpc: { fn_sud_citire_salveaza: { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 } } })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    const cheie = st.edgeApeluri[0][1].cerere
    await e.click(e.buton('Reia salvarea'))
    expect(e.text()).toContain('Salvarea nu s-a confirmat')
    expect(intrari(e)).toHaveLength(1); expect(e.buton('Reia salvarea')).toBeTruthy()
    st.rpcRaspuns.fn_sud_citire_salveaza = { data: null, error: { code: '42501', message: 'sud: doar cel care a pornit citirea o poate inchide' } }
    await e.click(e.buton('Reia salvarea'))
    expect(intrari(e)).toHaveLength(1); expect(e.buton('Reia salvarea')).toBeTruthy()
    st.rpcRaspuns.fn_sud_citire_salveaza = { data: null, error: { code: '55000', message: 'sud: cererea de citire e deja incheiata (esuat)' } }
    await e.click(e.buton('Reia salvarea'))
    expect(intrari(e)).toEqual([]); expect(e.buton('Reia salvarea')).toBeUndefined()
    expect(e.text()).toContain('deja încheiată pe server')
    expect(salvari().map(r => r[1].p_cheie)).toEqual([cheie, cheie, cheie])
    expect(st.edgeApeluri).toHaveLength(1)
    expect(rand1(e)).toBe('T12S126')
    expect(e.text()).toContain('nu sunt salvate')
  })

  it('redeschiderea: încărcarea citește și rândul in_curs al cheii păstrate → citirea nesalvată revine cu «Reia salvarea»; cu rândul „gata”, intrarea iese', async () => {
    const e = await monteaza({ edge: EDGE_OK(SALVAT('T12S127'), NESALVAT), tabele: t => ({ ...t, sud_citiri: [CIT(3, 'principal', SALVAT('T12S125'))] }) })
    await e.click(e.randBuletin('401'))
    expect(rand1(e)).toBe('T12S125')
    await e.click(e.buton('Citește cu AI'))
    const cheie = st.edgeApeluri[0][1].cerere
    expect(rand1(e)).toBe('T12S127')
    // pe server cererea a rămas in_curs (salvarea edge-ului nu s-a confirmat)
    st.tabele.sud_citiri.push(CIT(4, 'principal', null, { stare: 'in_curs', cheie_idempotenta: cheie }))
    await e.click(e.buton('Închide'))
    expect(e.d.querySelector('iframe')).toBeNull()
    await e.click(e.randBuletin('401'))
    expect(rand1(e)).toBe('T12S127')                       // cea nesalvată (#4, in_curs) e mai nouă decât #3
    expect(e.text()).toContain('NU e salvată pe server')
    expect(e.buton('Reia salvarea')).toBeTruthy()
    expect(intrari(e)).toHaveLength(1)
    expect(st.edgeApeluri).toHaveLength(1)
    // serverul a salvat-o de fapt (doar răspunsul s-a pierdut): la redeschidere intrarea iese, citirea vine din server
    st.tabele.sud_citiri[1] = { ...st.tabele.sud_citiri[1], stare: 'gata', citire: SALVAT('T12S127') }
    await e.click(e.buton('Închide'))
    await e.click(e.randBuletin('401'))
    expect(intrari(e)).toEqual([])
    expect(e.buton('Reia salvarea')).toBeUndefined()
    expect(e.text()).toContain('Citirea AI salvată (claude-sonnet-5-5')
    expect(rand1(e)).toBe('T12S127')
    expect(st.edgeApeluri).toHaveLength(1)
  })

  it('pagină nouă: cheia păstrată „trimisa” cu rând in_curs se refolosește; cu rând „esuat” iese, iar apăsarea pornește o cerere nouă', async () => {
    const intr = { v: 1, cerere: KP, buletin_id: 1, tip: 'principal', faza: 'trimisa', creat_la: '2026-11-28T10:00:00.000Z' }
    const e = await monteaza({ stocare: { [PREF + KP]: intr }, edge: EDGE_ERR(409, 'citire_in_curs', 'O citire e în lucru.'),
      tabele: t => ({ ...t, sud_citiri: [CIT(4, 'principal', null, { stare: 'in_curs', cheie_idempotenta: KP })] }) })
    await e.click(e.randBuletin('401'))
    expect(e.text()).toContain('reia aceeași cerere')
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri[0][1].cerere).toBe(KP)
    expect(intrari(e).map(x => x.cerere)).toEqual([KP])
    const v = await monteaza({ stocare: { [PREF + KP]: intr }, edge: EDGE_OK(SALVAT('T12S126')),
      tabele: t => ({ ...t, sud_citiri: [CIT(4, 'principal', null, { stare: 'esuat', cheie_idempotenta: KP, eroare_cod: 'apel_ai_esuat' })] }) })
    await v.click(v.randBuletin('401'))
    expect(intrari(v)).toEqual([])
    expect(v.text()).toContain('s-a încheiat pe server cu eroare (apel_ai_esuat)')
    await v.click(v.buton('Citește cu AI'))
    expect(st.edgeApeluri[0][1].cerere).not.toBe(KP)
  })

  it('pagină nouă cu o citire nesalvată păstrată: fără rând pe server → în tabel + «Reia salvarea»; citirea serverului picată → intrarea rămâne neatinsă', async () => {
    const intr = { v: 1, cerere: KP, buletin_id: 1, tip: 'principal', faza: 'nesalvata', creat_la: '2026-11-28T10:00:00.000Z',
      raspuns: { citire: SALVAT('T12S126'), cost_usd: 0.0123, cost_cunoscut: true, model: 'claude-sonnet-5-5' } }
    const e = await monteaza({ stocare: { [PREF + KP]: intr }, rpc: { fn_sud_citire_salveaza: { data: 44, error: null } } })
    await e.click(e.randBuletin('401'))
    expect(rand1(e)).toBe('T12S126')
    expect(e.buton('Reia salvarea')).toBeTruthy(); expect(intrari(e)).toHaveLength(1)
    await e.click(e.buton('Reia salvarea'))
    expect(salvari()[0][1]).toEqual({ p_cheie: KP, p_citire: SALVAT('T12S126'), p_cost_usd: 0.0123, p_cost_cunoscut: true, p_eroare: null })
    expect(intrari(e)).toEqual([]); expect(e.text()).toContain('nicio corectură nesalvată')
    expect(st.edgeApeluri).toEqual([])
    const v = await monteaza({ stocare: { [PREF + KP]: intr }, erori: { sud_citiri: { code: '', message: 'TypeError: Failed to fetch' } } })
    await v.click(v.randBuletin('401'))
    expect(v.text()).toContain('Citirile AI salvate nu s-au putut citi')
    expect(v.buton('Reia salvarea')).toBeTruthy(); expect(intrari(v)).toHaveLength(1)
  })

  it('panoul închis cât răspunsul e în drum: „salvare neconfirmată” ajunge totuși în browser (decizia cheii înaintea tokenului) și revine la redeschidere', async () => {
    const a = amanat()
    const e = await monteaza({ edge: () => a.p })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(intrari(e)).toEqual([expect.objectContaining({ faza: 'trimisa' })])
    await e.click(e.buton('Închide'))
    expect(e.d.querySelector('iframe')).toBeNull()
    a.rezolva(EDGE_OK(SALVAT('T12S126'), NESALVAT))
    await e.asteapta()
    expect(intrari(e)).toEqual([expect.objectContaining({ faza: 'nesalvata', raspuns: expect.objectContaining({ cost_usd: 0.0123 }) })])
    await e.click(e.randBuletin('401'))
    expect(rand1(e)).toBe('T12S126')
    expect(e.buton('Reia salvarea')).toBeTruthy()
  })

  it('L05: dacă browserul nu poate păstra cheia, citirea plătită NU pornește (introducerea manuală rămâne)', async () => {
    const e = await monteaza({ stocareRupta: true, edge: EDGE_OK(SALVAT('T12S126')) })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri).toEqual([])
    expect(e.text()).toContain('Browserul nu permite păstrarea cererii')
    expect(e.buton('+ Rând')).toBeTruthy()
  })

  it('«Renunță la ea» = alegerea omului: intrarea iese după confirmare, apăsarea următoare pornește o cerere nouă', async () => {
    const e = await monteaza({ edge: EDGE_OK(SALVAT('T12S126'), NESALVAT) })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    const cheie = st.edgeApeluri[0][1].cerere
    e.j.window.confirm.mockReturnValueOnce(false)
    await e.click(e.buton('Renunță la ea'))
    expect(intrari(e)).toHaveLength(1)
    await e.click(e.buton('Renunță la ea'))
    expect(intrari(e)).toEqual([]); expect(e.buton('Reia salvarea')).toBeUndefined()
    st.edge = EDGE_OK(SALVAT('T12S126'))
    await e.click(e.buton('Citește cu AI'))
    expect(st.edgeApeluri[1][1].cerere).not.toBe(cheie)
  })

  it('ordinea livrării: edge nou + bază fără 20270115b → mesajul „actualizare”, nimic păstrat în browser, introducerea manuală rămâne', async () => {
    const e = await monteaza({ edge: EDGE_ERR(503, 'actualizare_in_curs', 'Citirea cu AI e oprită cât se face actualizarea serverului. Nimic consumat.') })
    await e.click(e.randBuletin('401'))
    await e.click(e.buton('Citește cu AI'))
    expect(e.text()).toContain('actualizarea serverului')
    expect(intrari(e)).toEqual([])
    expect(e.buton('+ Rând')).toBeTruthy()
  })
})
