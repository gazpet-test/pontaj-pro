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
// stocare de tip localStorage (length / key / getItem / setItem / removeItem); `plina` = setItem aruncă (QuotaExceededError)
const stocareFalsa = () => {
  const m = new Map(), s = { m, plina: false }
  Object.assign(s, { key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => m.delete(k),
    setItem: (k, v) => { if (s.plina) throw new Error('QuotaExceededError'); m.set(k, String(v)) } })
  Object.defineProperty(s, 'length', { get: () => m.size })
  return s
}
function clientFals({ probe = [], etape = [], tronsoane = LOT1, drept = true, eroareTronsoane = false, uid = 'u1', sesiune = null } = {}) {
  const T = {
    executie_probe_tronsoane: new Map(probe.map(r => [r.id, { ...r }])),
    executie_probe_etape: new Map(etape.map(r => [r.id, { ...r }])),
    executie_tronsoane: new Map(tronsoane.map(r => [r.id, { ...r }])),
    executie_probe_jurnal: new Map(),
    probe_calcule: new Map(),
  }
  const st = { poarta: null, rpc: [], auto: true, citiri: 0, esueazaCitiri: false }
  let idNou = 1000
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      then: (res, rej) => {
        st.citiri += 1
        if (st.esueazaCitiri) return Promise.resolve({ data: null, error: { message: 'rețea căzută' } }).then(res, rej)
        if (tabel === 'executie_tronsoane' && eroareTronsoane) return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res, rej)
        const instant = [...T[tabel].values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        const poarta = f.gt == null && tabel === 'executie_probe_etape' ? st.poarta : null
        return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: instant, error: null })).then(res, rej)
      },
    }
    return q
  }
  const jurnal = (proba_id, a, tinta) => { const j = { id: ++idNou, proba_id, cheie: a.p_cheie, tinta }; T.executie_probe_jurnal.set(j.id, j) }
  // ca serverul: aceeași cheie deja scrisă = duplicat (rândul curent), fără o nouă scriere
  const aplica = (fn, a) => {
    const j = [...T.executie_probe_jurnal.values()].find(x => x.cheie === a.p_cheie)
    if (j) return j.tinta.etapa ? { ok: true, duplicat: true, etapa: { ...T.executie_probe_etape.get(j.tinta.etapa) } }
                                 : { ok: true, duplicat: true, proba: { ...T.executie_probe_tronsoane.get(j.tinta.proba) } }
    const r = aplicaFara(fn, a)
    if (r.ok) jurnal(r.proba?.id ?? r.etapa?.proba_id, a, r.etapa ? { etapa: r.etapa.id } : { proba: r.proba.id })
    return r
  }
  const aplicaFara = (fn, a) => {
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
    // identitatea din sesiune; `sesiune` (amana) = getSession întârziat până îl eliberează testul
    ...(uid ? { auth: { getSession: async () => { if (sesiune) await sesiune.p; return { data: { session: { user: { id: uid } } }, error: null } } } } : {}),
    from: tabel => interogare(tabel),
    rpc: (fn, a) => {
      if (fn === 'fn_executie_nod_drept') return Promise.resolve({ data: drept, error: null })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      if (st.auto) d.res('ok')
      return d.p.then(mod => {
        if (mod === 'eroare') return { data: null, error: { message: 'timeout simulat' } }
        if (mod === 'pierdut') { aplica(fn, a); return { data: null, error: { message: 'răspuns pierdut' } } }   // scris pe server, răspunsul nu ajunge
        if (mod === 'interzis') return { data: null, error: { code: '42501', message: 'probe: etapa nu există sau nu ai drept de scriere pe Execuție' } }
        if (mod === 'lipsa') return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
        if (mod === 'gol') return { data: null, error: null }
        if (mod === 'refuz') return { data: null, error: { code: '22023', message: 'probe: intervalul se suprapune cu P1 (de la 0 m la 10400 m)' } }
        return { data: aplica(fn, a), error: null }
      })
    },
  }
  return { client, st, T }
}

let curata = []
// în ordine inversă: o montare a doua în același test se demontează înainte ca prima să readucă `window` / `document` vechi
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client, proiectId = 1, stocare = stocareFalsa()) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  const randeaza = async pid => { await act(async () => { root.render(<ProbeTronsoane proiectId={pid} client={client} stocare={stocare} />) }); await asteapta() }
  await randeaza(proiectId)
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
  return { d, act, asteapta, apasa, buton, camp, scrie, elibereaza, text, demonteaza, randeaza }
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

  it('L05: rezultat necunoscut -> reluarea cu formularul neschimbat are aceeași cerere și aceeași cheie', async () => {
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
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.text()).toContain('48,3 bar')
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

  it('L24: salvare pornită pe proiectul 1, răspunsul vine după trecerea pe proiectul 2 -> niciun efect pe proiectul 2', async () => {
    const P2 = { ...P1, id: 7, proiect_id: 2, cod: 'P1', km_de_la_m: 0, km_pana_la_m: 500 }
    const { client, st } = clientFals({ probe: [P1, P2], etape: [...ETAPE_P1(), ...ETAPE.map((x, i) => ETAPA(70 + i, 7, x, { proiect_id: 2 }))] })
    st.auto = false
    const u = await monteaza(client, 1)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '10+400')
    await u.scrie('Până la km', '14+000')
    await u.apasa(u.buton('Salvează'))                                     // în zbor
    await u.randeaza(2)                                                    // alt proiect
    const citiri = st.citiri
    await u.elibereaza(st.rpc[0], 'ok')                                    // răspunsul pentru proiectul 1
    expect(u.text()).toContain('km 0+000 → 0+500')                         // P1 al proiectului 2
    expect(u.text()).not.toContain('10+400 → 14+000')
    expect(u.text()).not.toContain('Salvat.')
    expect(st.citiri).toBe(citiri)                                         // nicio reîncărcare pornită de răspunsul vechi
    expect(u.d.querySelector('[role="dialog"]')).toBeNull()
  })

  it('L05: formular schimbat după un rezultat necunoscut -> întâi retrimiterea IDENTICĂ a cererii vechi (aceeași cheie); o nouă eroare o lasă în așteptare', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')
    await u.scrie('Presiunea curentă', '48,1')                             // formular schimbat -> reconciliere = retrimiterea cererii vechi
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(2)
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)                               // același payload (48,3) și aceeași cheie
    await u.elibereaza(st.rpc[1], 'eroare')                               // tot necunoscut
    expect(u.text()).toContain('tot fără rezultat sigur')
    await u.apasa(u.buton('Salvează'))                                     // noua intenție NU pleacă: din nou cererea veche
    expect(st.rpc[2].a).toEqual(st.rpc[0].a)
    await u.elibereaza(st.rpc[2], 'ok')                                    // abia acum definitiv (nu ajunsese: aplicată acum)
    expect(u.text()).toContain('Cererea anterioară nu ajunsese; am trimis-o acum')
    await u.scrie('Presiunea curentă', '48,1')
    await u.apasa(u.buton('Salvează'))                                     // noua intenție, cu cheie nouă, pe versiunea nouă
    expect(st.rpc[3].a.p_cheie).not.toBe(st.rpc[0].a.p_cheie)
    expect(st.rpc[3].a).toMatchObject({ p_versiune: 4, p_presiune_curenta_bar: 48.1 })
  })

  it('L05: răspuns pierdut după scriere -> retrimiterea primește „duplicat”, deci se salvase; fără a doua scriere', async () => {
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'pierdut')                              // scris pe server, răspunsul nu a ajuns
    expect(u.text()).toContain('Nu se știe dacă s-a salvat')
    await u.scrie('Presiunea curentă', '48,0')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.text()).toContain('Cererea anterioară SE salvase')
    expect(T.executie_probe_etape.get(14).versiune).toBe(4)                // o singură scriere
    expect(u.text()).toContain('48,3 bar')
  })

  it('L05: creare cu rezultat necunoscut, apoi alt cod / interval -> întâi crearea veche se lămurește (cu cheia ei), abia apoi cea nouă', async () => {
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '10+400')
    await u.scrie('Până la km', '14+000')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')                               // nu se știe dacă P2 s-a creat
    await u.scrie('Cod', 'P3')
    await u.scrie('De la km', '19+000')
    await u.scrie('Până la km', '24+000')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)                               // crearea veche, cu cheia ei
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.text()).toContain('Cererea anterioară nu ajunsese; am trimis-o acum')
    await u.apasa(u.buton('Salvează'))                                     // abia acum P3, cu cheie nouă
    expect(st.rpc[2].a).toMatchObject({ p_cod: 'P3', p_km_de_la_m: 19000 })
    expect(st.rpc[2].a.p_cheie).not.toBe(st.rpc[0].a.p_cheie)
    await u.elibereaza(st.rpc[2], 'ok')
    expect([...T.executie_probe_tronsoane.values()].map(p => p.cod).sort()).toEqual(['P1', 'P2', 'P3'])   // fiecare intenție o singură dată
  })

  it('conflict pe formularul etapei: avertisment cu valorile de pe server; „Ia valorile de pe server” reface formularul', async () => {
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    Object.assign(T.executie_probe_etape.get(14), { presiune_curenta_bar: 47.5, versiune: 4 })   // altcineva a citit între timp
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[0].a.p_versiune).toBe(3)
    expect(u.text()).toContain('Între timp etapa s-a schimbat pe server')
    expect(u.text()).toContain('acum 47,5 bar')
    expect(u.camp('Presiunea curentă').value).toBe('48,3')                 // valoarea scrisă de om a rămas
    await u.apasa(u.buton('Ia valorile de pe server'))
    expect(u.camp('Presiunea curentă').value).toBe('47,5')
    expect(u.text()).not.toContain('Între timp etapa s-a schimbat pe server')
    await u.scrie('Presiunea curentă', '47,4')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 4, p_presiune_curenta_bar: 47.4 })
  })

  it('conflict pe formularul de interval: baza devine versiunea nouă, câmpurile scrise rămân, a doua apăsare trimite versiunea nouă', async () => {
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Modifică intervalul'))
    await u.scrie('Până la km', '10+500')
    Object.assign(T.executie_probe_tronsoane.get(1), { km_pana_la_m: 10450, versiune: 2 })   // altcineva a modificat între timp
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[0].a.p_versiune).toBe(1)
    expect(u.text()).toContain('S-a schimbat între timp')
    expect(u.text()).toContain('Între timp tronsonul s-a schimbat: acum e P1, km 0+000 → 10+450')
    expect(u.camp('Până la km').value).toBe('10+500')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[1].a).toMatchObject({ p_versiune: 2, p_km_pana_la_m: 10500 })
    expect(u.text()).toContain('Salvat.')
  })

  it('L05 persistent: pagina închisă după un răspuns pierdut -> la redeschidere, bannerul retrimite cererea cu cheia ei', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1(), uid: 'u1' })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    expect(stocare.m.size).toBe(1)                                         // scrisă în registru ÎNAINTE de răspuns
    await u.elibereaza(st.rpc[0], 'eroare')
    u.demonteaza()                                                         // omul pleacă / reîncarcă pagina
    const v = await monteaza(client, 1, stocare)
    expect(v.text()).toContain('O salvare are rezultat nelămurit')
    await v.apasa(v.buton('Lămurește acum'))
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)                               // același payload și aceeași cheie
    await v.elibereaza(st.rpc[1], 'ok')
    expect(v.text()).toContain('Cererea anterioară nu ajunsese; am trimis-o acum')
    expect(v.text()).not.toContain('rezultat nelămurit')
    expect(stocare.m.size).toBe(0)
  })

  it('L05 persistent: plecare pe alt proiect înaintea răspunsului -> cererea rămâne în registrul proiectului ei; la întoarcere se lămurește', async () => {
    const stocare = stocareFalsa()
    const P2 = { ...P1, id: 7, proiect_id: 2, km_de_la_m: 0, km_pana_la_m: 500 }
    const { client, st, T } = clientFals({ probe: [P1, P2], etape: [...ETAPE_P1(), ...ETAPE.map((x, i) => ETAPA(70 + i, 7, x, { proiect_id: 2 }))], uid: 'u1' })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))                                     // în zbor
    await u.randeaza(2)
    expect(u.text()).not.toContain('rezultat nelămurit')                  // registrul e pe proiect
    await u.elibereaza(st.rpc[0], 'pierdut')                              // scrisă, dar răspunsul nu ajunge
    await u.randeaza(1)
    expect(u.text()).toContain('O salvare are rezultat nelămurit')
    await u.apasa(u.buton('Lămurește acum'))
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.text()).toContain('Cererea anterioară SE salvase')
    expect(T.executie_probe_etape.get(14).versiune).toBe(4)                // o singură scriere
    expect(stocare.m.size).toBe(0)
  })

  it('L05: retrimiterea refuzată de DREPT nu dovedește nimic: cheia găsită în jurnal = se salvase; negăsită = nu se mai poate lămuri', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'pierdut')                              // scrisă (cheia e în jurnal)
    await u.scrie('Presiunea curentă', '48,1')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[1], 'interzis')                             // între timp i s-a luat dreptul
    expect(u.text()).toContain('Cererea anterioară SE salvase')
    // a doua: nescrisă, apoi refuz de drept -> nu se poate lămuri, dar nu se pretinde că „nu s-a salvat”
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[2], 'eroare')
    await u.scrie('Presiunea curentă', '48,0')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[3], 'interzis')
    expect(u.text()).toContain('nu se poate lămuri acum: nu mai ai drept de scriere')
  })

  it('L05: reapăsarea aceleiași cereri trece prin aceeași lămurire: 42501 / PGRST202 / răspuns gol NU scot cererea din registru', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'gol')                                   // răspuns gol = nelămurit (nu „definitiv”)
    expect(stocare.m.size).toBe(1)
    expect(u.text()).toContain('Nu se știe dacă s-a salvat')
    for (const [i, mod] of [[1, 'interzis'], [2, 'lipsa'], [3, 'gol']]) {
      await u.apasa(u.buton('Salvează'))                                   // aceeași cerere
      expect(st.rpc[i].a).toEqual(st.rpc[0].a)
      await u.elibereaza(st.rpc[i], mod)
      expect(stocare.m.size).toBe(1)                                       // tot în registru
    }
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[4], 'ok')                                    // abia acum definitiv: salvată
    expect(stocare.m.size).toBe(0)
    expect(u.text()).toContain('48,3 bar')
  })

  it('L05: reapăsare -> 42501 -> cheia găsită în jurnal: „se salvase”, fără rând presupus (etapă și creare, fără excepții)', async () => {
    const stocare = stocareFalsa()
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'pierdut')                              // scrisă, răspuns pierdut
    await u.apasa(u.buton('Salvează'))                                     // aceeași cerere
    await u.elibereaza(st.rpc[1], 'interzis')                             // între timp i s-a luat dreptul
    expect(u.text()).toContain('SE salvase (confirmat din jurnal')
    expect(stocare.m.size).toBe(0)
    await u.apasa(u.d.querySelector('button[aria-label="Închide"]'))
    await u.apasa(u.d.querySelector('button[aria-label="Închide"]'))
    // creare: aceeași poveste, fără „x.r.proba” pe un rezultat nul
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '10+400'); await u.scrie('Până la km', '14+000')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[2], 'pierdut')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[3], 'interzis')
    expect(u.text()).toContain('SE salvase (confirmat din jurnal')
    expect([...T.executie_probe_tronsoane.values()].filter(p => p.cod === 'P2')).toHaveLength(1)
    expect(stocare.m.size).toBe(0)
  })

  it('L05: două tab-uri, aceeași cheie în zbor: retrimiterea din B aplică și pierde răspunsul, apoi prima încercare din A primește 42501 -> confirmat din jurnal, nu șters orbește', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const a = await monteaza(client, 1, stocare)
    await a.apasa(a.buton('P1'))
    await a.apasa(a.buton('Citire / actualizare'))
    await a.scrie('Presiunea curentă', '48,3')
    await a.apasa(a.buton('Salvează'))                                     // rpc[0], în zbor
    const b = await monteaza(client, 1, stocare)
    await b.apasa(b.buton('P1'))
    await b.apasa(b.buton('Citire / actualizare'))
    await b.scrie('Presiunea curentă', '47,0')
    await b.apasa(b.buton('Salvează'))                                     // B lămurește întâi cererea lui A: aceeași cheie
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)
    await b.elibereaza(st.rpc[1], 'pierdut')                              // aplicată, răspunsul nu ajunge la B
    expect(stocare.m.size).toBe(1)                                         // B nu știe: rămâne
    await a.elibereaza(st.rpc[0], 'interzis')                             // prima încercare din A: refuz de drept
    expect(a.text()).toContain('Salvarea s-a făcut (confirmată din jurnal')
    expect(stocare.m.size).toBe(0)                                         // scoasă DOAR pentru că jurnalul o dovedește
  })

  it('L05: prima încercare refuzată de drept, cheie negăsită în jurnal: cererea rămâne de verificat', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'interzis')
    expect(u.text()).toContain('Cererea rămâne de verificat')
    expect(stocare.m.size).toBe(1)
  })

  it('L05: refuz de drept la retrimitere + jurnal necitit = tot nelămurit (rămâne în registru)', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')
    await u.apasa(u.buton('Salvează'))
    st.esueazaCitiri = true                                                // citirea jurnalului va eșua
    await u.elibereaza(st.rpc[1], 'interzis')
    st.esueazaCitiri = false
    expect(u.text()).toContain('tot fără rezultat sigur')
    expect(stocare.m.size).toBe(1)
  })

  it('stocare plină: cererea NU se trimite (un rezultat nelămurit s-ar pierde), cu mesaj explicit', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client, 1, stocare)
    stocare.plina = true
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(0)
    expect(u.text()).toContain('Nu pot păstra local cererea')
  })

  it('fără stocare locală: salvarea e oprită, cu mesaj; identitatea întârziată: salvarea așteaptă registrul', async () => {
    const { client } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    const u = await monteaza(client, 1, null)
    expect(u.text()).toContain('Stocarea locală a browserului nu e disponibilă')
    u.demonteaza()
    const ses = amana()
    const c2 = clientFals({ probe: [P1], etape: ETAPE_P1(), sesiune: ses })
    const v = await monteaza(c2.client, 1, stocareFalsa())
    await v.apasa(v.buton('P1'))
    await v.apasa(v.buton('Citire / actualizare'))
    await v.scrie('Presiunea curentă', '48,3')
    expect(v.buton('Salvează').disabled).toBe(true)                        // registrul încă nu e gata
    await v.apasa(v.buton('Salvează'))
    expect(c2.st.rpc).toHaveLength(0)
    await v.elibereaza(ses, undefined)
    expect(v.buton('Salvează').disabled).toBe(false)
    await v.apasa(v.buton('Salvează'))
    expect(c2.st.rpc).toHaveLength(1)
  })

  const creeaza = async (u, cod, de, pana) => {
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('Cod', cod); await u.scrie('De la km', de); await u.scrie('Până la km', pana)
    await u.apasa(u.buton('Salvează'))
  }
  it('două tab-uri, ținte diferite, ambele nelămurite: nicio cerere suprascrisă; la redeschidere se lămuresc amândouă', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const t1 = await monteaza(client, 1, stocare)
    await creeaza(t1, 'P2', '10+400', '14+000')                            // ținta „nou”
    const t2 = await monteaza(client, 1, stocare)                          // al doilea tab, același browser
    await t2.apasa(t2.buton('P1'))
    await t2.apasa(t2.buton('Citire / actualizare'))
    await t2.scrie('Presiunea curentă', '48,3')
    await t2.apasa(t2.buton('Salvează'))                                   // ținta „etapa:14”
    await t1.elibereaza(st.rpc[0], 'eroare'); await t2.elibereaza(st.rpc[1], 'eroare')
    expect(stocare.m.size).toBe(2)
    t2.demonteaza(); t1.demonteaza()
    const t3 = await monteaza(client, 1, stocare)
    expect(t3.text()).toContain('2 salvări au rezultat nelămurit')
    await t3.apasa(t3.buton('Lămurește acum'))
    await t3.elibereaza(st.rpc[2], 'ok'); await t3.elibereaza(st.rpc[3], 'ok')
    expect([st.rpc[2].a, st.rpc[3].a]).toEqual(expect.arrayContaining([st.rpc[0].a, st.rpc[1].a]))
    expect(stocare.m.size).toBe(0)
  })

  it('două tab-uri, aceeași țintă: al doilea tab lămurește ÎNTÂI crearea nelămurită a primului (cu cheia ei), abia apoi o trimite pe a lui', async () => {
    const stocare = stocareFalsa()
    const { client, st, T } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const t1 = await monteaza(client, 1, stocare)
    await creeaza(t1, 'P2', '10+400', '14+000')
    await t1.elibereaza(st.rpc[0], 'eroare')                              // nelămurită în tab-ul 1
    const t2 = await monteaza(client, 1, stocare)
    await creeaza(t2, 'P3', '19+000', '24+000')
    expect(st.rpc[1].a).toEqual(st.rpc[0].a)                               // retrimiterea crearii din tab-ul 1
    await t2.elibereaza(st.rpc[1], 'ok')
    expect(t2.text()).toContain('Cererea anterioară nu ajunsese; am trimis-o acum')
    await t2.apasa(t2.buton('Salvează'))                                   // abia acum P3, cu cheie nouă
    expect(st.rpc[2].a).toMatchObject({ p_cod: 'P3' })
    await t2.elibereaza(st.rpc[2], 'ok')
    expect([...T.executie_probe_tronsoane.values()].map(p => p.cod).sort()).toEqual(['P1', 'P2', 'P3'])
    expect(stocare.m.size).toBe(0)
  })

  it('renunțarea la verificare cere confirmare și scoate cererile din registru', async () => {
    const stocare = stocareFalsa()
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client, 1, stocare)
    await u.apasa(u.buton('＋ Tronson de probă nou'))
    await u.scrie('De la km', '10+400'); await u.scrie('Până la km', '14+000')
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'eroare')
    u.demonteaza()
    const v = await monteaza(client, 1, stocare)
    await v.apasa(v.buton('Renunță la verificare'))
    expect(stocare.m.size).toBe(1)                                         // primul pas nu scoate nimic
    await v.apasa(v.buton('da, renunț'))
    expect(stocare.m.size).toBe(0)
    expect(v.text()).not.toContain('rezultat nelămurit')
  })

  it('demontare în timpul salvării: răspunsul întârziat nu aruncă și nu pornește încărcări', async () => {
    const { client, st } = clientFals({ probe: [P1], etape: ETAPE_P1() })
    st.auto = false
    const u = await monteaza(client)
    await u.apasa(u.buton('P1'))
    await u.apasa(u.buton('Citire / actualizare'))
    await u.scrie('Presiunea curentă', '48,3')
    await u.apasa(u.buton('Salvează'))
    u.demonteaza()
    const citiri = st.citiri
    await u.elibereaza(st.rpc[0], 'ok')
    expect(st.citiri).toBe(citiri)
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
