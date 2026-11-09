// Teste de componentă pentru ProbeTronsoane: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS ale cărui
// răspunsuri se pot elibera manual (ordinea răspunsurilor e controlată de test). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la src/NodCuplareSchema.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR
// (un director cu jsdom instalat). Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import ProbeTronsoane from './ProbeTronsoane.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[ProbeTronsoane.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const ETAPE = ['pistonare', 'uscare', 'calibrare', 'presiune']
const LOT1 = [['T1', 0, 2000], ['T2', 2000, 5000], ['T3', 5000, 10000], ['T4', 10000, 14000], ['T5', 14000, 19000]]
  .map(([cod, a, b], i) => ({ id: 50 + i, proiect_id: 1, cod, km_start_m: a, km_end_m: b }))
const ETAPA = (id, proba_id, etapa, extra = {}) => ({
  id, proba_id, proiect_id: 1, etapa, stare: 'urmeaza', data_start: null, data_final: null, data_stare: null, nr_treceri: null, punct_roua_c: null,
  placa: null, fluid: null, presiune_proba_bar: null, presiune_curenta_bar: null, presiune_curenta_la: null, durata_ore: null, probe_calc_id: null,
  rezultat: null, observatii: null, motiv: null, versiune: 1, ...extra,
})

// „serverul”: tabele în memorie; o citire face instantaneul LA CERERE și îl livrează când testul deschide poarta (dacă e setată);
// un RPC se aplică abia când testul îl eliberează ('ok' / 'eroare' de rețea / 'refuz' 22023), sau imediat când st.auto = true
function clientFals({ probe = [], etape = [], tronsoane = LOT1, drept = true, eroareTronsoane = false } = {}) {
  const T = {
    executie_probe_tronsoane: new Map(probe.map(r => [r.id, { ...r }])),
    executie_probe_etape: new Map(etape.map(r => [r.id, { ...r }])),
    executie_tronsoane: new Map(tronsoane.map(r => [r.id, { ...r }])),
    executie_probe_jurnal: new Map(),
    probe_calcule: new Map(),
  }
  const st = { poarta: null, rpc: [], auto: true, citiri: 0 }
  let idNou = 1000
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        st.citiri += 1
        if (tabel === 'executie_tronsoane' && eroareTronsoane) return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res, rej)
        const instant = [...T[tabel].values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        const poarta = f.gt == null && tabel === 'executie_probe_etape' ? st.poarta : null
        return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: instant, error: null })).then(res, rej)
      },
    }
    return q
  }
  const aplica = (fn, a) => {
    if (fn === 'fn_executie_proba_salveaza') {
      if (a.p_id == null) {
        const p = { id: ++idNou, proiect_id: a.p_proiect, cod: a.p_cod, denumire: a.p_denumire, km_de_la_m: a.p_km_de_la_m, km_pana_la_m: a.p_km_pana_la_m,
          observatii: a.p_observatii, stare: 'activ', motiv_anulare: null, versiune: 1 }
        T.executie_probe_tronsoane.set(p.id, p)
        ETAPE.forEach(e => { const r = ETAPA(++idNou, p.id, e); T.executie_probe_etape.set(r.id, r) })
        return { ok: true, duplicat: false, proba: { ...p } }
      }
      const p = T.executie_probe_tronsoane.get(a.p_id)
      if (p.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', proba: { ...p } }
      Object.assign(p, { cod: a.p_cod, km_de_la_m: a.p_km_de_la_m, km_pana_la_m: a.p_km_pana_la_m, versiune: p.versiune + 1 })
      return { ok: true, duplicat: false, proba: { ...p } }
    }
    if (fn === 'fn_executie_proba_etapa') {
      const e = T.executie_probe_etape.get(a.p_etapa_id)
      if (e.stare !== a.p_stare_veche || e.versiune !== a.p_versiune) return { ok: false, motiv: 'conflict', etapa: { ...e } }
      Object.assign(e, { stare: a.p_stare_noua, data_stare: a.p_data, nr_treceri: a.p_nr_treceri, presiune_proba_bar: a.p_presiune_proba_bar,
        presiune_curenta_bar: a.p_presiune_curenta_bar, presiune_curenta_la: a.p_presiune_curenta_bar == null ? null : '2026-11-09T10:00:00Z',
        fluid: a.p_fluid, durata_ore: a.p_durata_ore, observatii: a.p_observatii, motiv: a.p_motiv, versiune: e.versiune + 1 })
      return { ok: true, duplicat: false, etapa: { ...e } }
    }
    throw new Error('rpc necunoscut ' + fn)
  }
  const client = {
    from: tabel => interogare(tabel),
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: drept, error: null })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      if (st.auto) d.res('ok')
      return d.p.then(mod => {
        if (mod === 'eroare') return { data: null, error: { message: 'timeout simulat' } }
        if (mod === 'refuz') return { data: null, error: { code: '22023', message: 'probe: intervalul se suprapune cu P1 (de la 0 m la 10400 m)' } }
        return { data: aplica(fn, a), error: null }
      })
    },
  }
  return { client, st, T }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<ProbeTronsoane proiectId={1} client={client} />) })
  await asteapta()
  let montat = true
  const demonteaza = () => { if (montat) { montat = false; act(() => root.unmount()) } }
  curata.push(() => { demonteaza(); Object.assign(globalThis, vechi) })
  const elemente = () => [...d.querySelectorAll('button, [role="button"]')]
  const buton = text => { const b = elemente().filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const camp = eticheta => {
    const l = [...d.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent.startsWith(eticheta))
    if (!l) throw new Error('nu găsesc câmpul ' + eticheta)
    return l.querySelector('input, select, textarea')
  }
  const scrie = async (eticheta, val) => {
    const el = camp(eticheta)
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  const text = () => d.body.textContent
  return { d, act, asteapta, apasa, buton, camp, scrie, elibereaza, text, demonteaza }
}

const P1 = { id: 1, proiect_id: 1, cod: 'P1', denumire: null, km_de_la_m: 0, km_pana_la_m: 10400, observatii: null, stare: 'activ', motiv_anulare: null, versiune: 1 }
const ETAPE_P1 = () => [
  ETAPA(11, 1, 'pistonare', { stare: 'facut', nr_treceri: 4, data_start: '2026-11-02', data_final: '2026-11-03', data_stare: '2026-11-03', versiune: 3 }),
  ETAPA(12, 1, 'uscare', { stare: 'nu_se_aplica', motiv: 'probă cu aer', data_stare: '2026-11-03', versiune: 2 }),
  ETAPA(13, 1, 'calibrare', { stare: 'facut', placa: 'ok', data_start: '2026-11-04', data_final: '2026-11-04', data_stare: '2026-11-04', versiune: 2 }),
  ETAPA(14, 1, 'presiune', { stare: 'in_curs', fluid: 'aer', presiune_proba_bar: 48.5, presiune_curenta_bar: 48.4, presiune_curenta_la: '2026-11-09T08:20:00Z',
    data_start: '2026-11-08', data_stare: '2026-11-09', versiune: 3 }),
]

dom(numeDom('ProbeTronsoane (jsdom + react-dom)'), () => {
  it('lista: compoziția din tronsoane, etapele, presiunea curentă, banda și sumarul acoperirii', async () => {
    const { client } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    expect(u.text()).toContain('T1 + T2 + T3 + 400 m din T4')
    expect(u.text()).toContain('km 0+000 → 10+400')
    expect(u.text()).toContain('48,4 bar')
    expect(u.text()).toContain('(probă 48,5 bar)')
    expect(u.text()).toContain('În lucru')
    expect(u.text()).toContain('Fără probă: 10+400–19+000')        // traseul cunoscut în test: T1–T5 (0–19 km)
    expect(u.d.querySelector('svg[aria-label^="Banda traseului"]')).not.toBeNull()
    expect(u.text()).toContain('＋ Tronson de probă nou')
  })

  it('tronson nou: previzualizarea compoziției, apoi salvarea prin RPC (o singură cheie), cu cele 4 etape create', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    expect(u.camp('Cod').value).toBe('P2')
    await u.scrie('De la km', '10+400')
    await u.scrie('Până la km', '14+000')
    const m3600 = `${(3600).toLocaleString('ro-RO')} m`   // separatorul de mii al locale-ului ro-RO din Node
    expect(u.text()).toContain(`${m3600} · km 10+400 → 14+000`)
    expect(u.text()).toContain(`${m3600} din T4`)
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    expect(st.rpc[0].fn).toBe('fn_executie_proba_salveaza')
    expect(st.rpc[0].a).toMatchObject({ p_proiect: 1, p_id: null, p_versiune: null, p_cod: 'P2', p_km_de_la_m: 10400, p_km_pana_la_m: 14000 })
    expect(st.rpc[0].a.p_cheie).toMatch(/^[0-9a-f-]{36}$/)
    expect(u.text()).toContain('Salvat.')
    expect(u.text()).toContain('P2 · km 10+400 → 14+000')         // fișa noului tronson
    expect(u.text()).toContain('Pistonare / curățare')
  })

  it('suprapunerea se vede înainte de salvare; butonul rămâne oprit', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '10+000')
    await u.scrie('Până la km', '12+000')
    expect(u.text()).toContain('Se suprapune cu P1 (0+000–10+400)')
    expect(u.buton('Salvează').disabled).toBe(true)
    expect(st.rpc).toHaveLength(0)
  })

  it('L05: rezultat necunoscut -> reluarea identică are aceeași cheie; formular schimbat -> întâi reîncărcare, apoi cheie nouă', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(u.text()).toContain('Nu se știe dacă s-a salvat')
    await u.apasa(u.buton('Salvează'))                                     // aceeași cerere
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)
    expect(st.rpc[1].a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    await u.elibereaza(st.rpc[1], 'eroare')
    const citiri = st.citiri
    await u.scrie('Presiunea curentă', '48,2')                             // formular schimbat
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(2)                                         // nicio cerere nouă: întâi reconciliere
    expect(st.citiri).toBeGreaterThan(citiri)
    expect(u.text()).toContain('am adus starea reală')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(3)
    expect(st.rpc[2].a.p_cheie).not.toBe(st.rpc[0].a.p_cheie)
    expect(st.rpc[2].a.p_presiune_curenta_bar).toBe(48.2)
    await u.elibereaza(st.rpc[2], 'ok')
    expect(u.text()).toContain('48,2 bar')
  })

  it('refuzul serverului (22023) se afișează curat și nu păstrează cheia', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '11+000')
    await u.scrie('Până la km', '12+000')
    st.auto = false
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'refuz')
    expect(u.text()).toContain('intervalul se suprapune cu P1 (de la 0 m la 10400 m)')
    expect(u.text()).not.toContain('Nu se știe dacă s-a salvat')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a.p_cheie).not.toBe(st.rpc[0].a.p_cheie)
  })

  it('L24: o citire veche terminată după o salvare nu readuce versiunea veche a etapei', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    st.poarta = amana()
    await u.apasa(u.buton('↻ Reîncarcă'))                                 // instantaneul vechi (48,4) rămâne în zbor
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '47,9')
    await u.apasa(u.buton('Salvează'))                                     // auto: v4 aplicat local
    await u.elibereaza(st.poarta, undefined)                               // abia acum ajunge citirea veche (v3)
    st.poarta = null
    expect(u.text()).toContain('47,9 bar')
  })

  it('doar citire: fără butoane de scriere; tronsoanele necitite = avertisment, nu „neacoperit”', async () => {
    const { client } = clientFals({ probe: [P1], etape: ETAPE_P1(), drept: false, eroareTronsoane: true })
    const u = await monteaza(client)
    expect(u.text()).toContain('Doar citire')
    expect(u.text()).not.toContain('＋ Tronson de probă nou')
    expect(u.text()).toContain('Tronsoanele de execuție nu s-au putut citi')
    expect(u.text()).not.toContain('T1 + T2')
    await u.apasa(u.buton('P1'))
    expect(u.text()).not.toContain('Completează')
    expect(u.text()).not.toContain('Citire / actualizare')
    expect(u.text()).not.toContain('Anulează')
  })
})
