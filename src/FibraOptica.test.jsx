// Teste de componentă pentru FibraOptica: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS ale cărui
// răspunsuri RPC se pot elibera manual. Fără rețea, fără librării noi. Date SINTETICE (tronsoane T1 / T2 fictive).
// jsdom nu e dependență a proiectului (ca la src/ProbeTronsoane.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import FibraOptica from './FibraOptica.jsx'
import { ziBucuresti } from './lib/izoTeren.js'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[FibraOptica.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const AZI = ziBucuresti()
const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const TR = [{ id: 1, proiect_id: 1, cod: 'T1', denumire: null, km_start_m: 10000, km_end_m: 12000 },
  { id: 2, proiect_id: 1, cod: 'T2', denumire: null, km_start_m: 12000, km_end_m: 15000 }]
const INT = (id, etapa, a, b, extra = {}) => ({ id, proiect_id: 1, tronson_id: 1, etapa, km_de_la_m: a, km_pana_la_m: b, data_lucru: AZI, observatii: null,
  stare: 'activ', motiv_anulare: null, anulat_de: null, anulat_nume: null, anulat_la: null, raportat_de: 'u1', raportat_nume: 'EDITOR UNU', creat_la: `2026-11-0${id % 9}T08:00:00Z`, ...extra })
const CAM = (id, cod, km, extra = {}) => ({ id, proiect_id: 1, tronson_id: 1, cod, km_m: km, stare: 'de_montat', data_montare: null, montat_de: null, montat_nume: null,
  sursa: 'proiect', observatii: null, motiv: null, versiune: 1, creat_de: null, creat_nume: null, creat_la: '2026-11-01T08:00:00Z', ...extra })

const stocareFalsa = () => {
  const m = new Map(), s = { m }
  Object.assign(s, { key: i => [...m.keys()][i] ?? null, getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => { m.delete(k) }, setItem: (k, v) => { m.set(k, String(v)) } })
  Object.defineProperty(s, 'length', { get: () => m.size })
  return s
}
function clientFals({ intervale = [], camerete = [], drept = true, uid = 'u1', owner = false, esueazaIntervale = false } = {}) {
  const T = { executie_tronsoane: new Map(TR.map(r => [r.id, { ...r }])), executie_fibra_intervale: new Map(intervale.map(r => [r.id, { ...r }])),
    executie_fibra_camerete: new Map(camerete.map(r => [r.id, { ...r }])), executie_fibra_jurnal: new Map() }
  const st = { rpc: [], auto: true }
  let idNou = 1000
  const interogare = tabel => {
    const f = { eq: [], gt: null, lim: 1000 }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      maybeSingle: () => Promise.resolve({ data: tabel === 'profiles' ? { is_owner: owner } : null, error: null }),
      then: (res, rej) => {
        if (tabel === 'executie_fibra_intervale' && (esueazaIntervale || st.esueazaIntervale)) return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res, rej)
        const date = [...(T[tabel] || new Map()).values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim).map(r => ({ ...r }))
        return Promise.resolve({ data: date, error: null }).then(res, rej)
      },
    }
    return q
  }
  const aplica = (fn, a) => {
    const j = [...T.executie_fibra_jurnal.values()].find(x => x.cheie === a.p_cheie)
    if (j) return { ok: true, duplicat: true, interval: { ...T.executie_fibra_intervale.get(j.interval_id) } }
    if (fn === 'fn_executie_fibra_raporteaza') {
      const i = INT(++idNou, a.p_etapa, a.p_km_de_la_m, a.p_km_pana_la_m, { tronson_id: a.p_tronson, data_lucru: a.p_data, creat_la: '2026-11-10T09:00:00Z' })
      T.executie_fibra_intervale.set(i.id, i)
      T.executie_fibra_jurnal.set(++idNou, { id: idNou, cheie: a.p_cheie, interval_id: i.id, tronson_id: i.tronson_id })
      return { ok: true, duplicat: false, interval: { ...i } }
    }
    if (fn === 'fn_executie_fibra_anuleaza') {
      const i = T.executie_fibra_intervale.get(a.p_id)
      Object.assign(i, { stare: 'anulat', motiv_anulare: a.p_motiv, anulat_la: '2026-11-10T10:00:00Z', anulat_nume: 'EDITOR UNU' })
      T.executie_fibra_jurnal.set(++idNou, { id: idNou, cheie: a.p_cheie, interval_id: i.id, tronson_id: i.tronson_id })
      return { ok: true, duplicat: false, interval: { ...i } }
    }
    throw new Error('rpc necunoscut ' + fn)
  }
  const client = {
    ...(uid ? { auth: { getSession: async () => ({ data: { session: { user: { id: uid } } }, error: null }) } } : {}),
    from: tabel => interogare(tabel),
    rpc: (fn, a) => {
      if (fn === 'fn_executie_fibra_drept') return Promise.resolve({ data: drept, error: null })
      const d = amana(); st.rpc.push({ fn, a, ...d })
      // st.devreme: serverul scrie și răspunde LA APEL (instantaneul de atunci), dar răspunsul ajunge abia la eliberare (rețea lentă)
      const devreme = st.devreme ? aplica(fn, a) : null
      if (st.auto) d.res('ok')
      return d.p.then(mod => {
        if (mod === 'eroare') return { data: null, error: { message: 'timeout simulat' } }
        if (mod === 'refuz') return { data: null, error: { code: '23514', message: 'fibra: porțiunea km 10+400–10+500 e deja raportată pe 10.11 (monotub montat)' } }
        return { data: devreme || aplica(fn, a), error: null }
      })
    },
  }
  return { client, st, T }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client, stocare = stocareFalsa()) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<FibraOptica proiectId={1} client={client} stocare={stocare} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const butoane = () => [...d.querySelectorAll('button')]
  const buton = text => { const b = butoane().filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (eticheta, val) => {
    const l = [...d.querySelectorAll('label')].find(x => x.querySelector('span')?.textContent.startsWith(eticheta))
    if (!l) throw new Error('nu găsesc câmpul ' + eticheta)
    const el = l.querySelector('input')
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event('input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  return { d, apasa, buton, butoane, scrie, elibereaza, asteapta, text: () => d.body.textContent }
}

dom(numeDom('FibraOptica (jsdom + react-dom)'), () => {
  it('tronsonul ales: bara cu etapele și cameretele, rezumatul azi / cumulat / rest, istoricul', async () => {
    const { client } = clientFals({ intervale: [INT(1, 'monotub', 10000, 11000), INT(2, 'validat', 10000, 10500)], camerete: [CAM(1, 'CT-1', 10500, { stare: 'montata', data_montare: AZI })] })
    const u = await monteaza(client)
    expect(u.d.querySelector('svg[aria-label^="Bara tronsonului T1"]')).not.toBeNull()
    // T1 = 2000 m: monotub 1000 m (50%), validat 500 m (25%), suflat 0
    expect(u.text()).toContain('50%')
    expect(u.text()).toContain('25%')
    expect(u.text()).toContain('rest 1.000 m')
    expect(u.text()).toContain('Camerete (1 montate din 1)')
    expect(u.text()).toContain('km 10+000 → 11+000')
    expect(u.buton('📏 Raportează')).toBeTruthy()
  })

  it('raportarea: cheia e în registru ÎNAINTE de răspuns, RPC-ul o singură dată, apoi registrul se golește', async () => {
    const { client, st, T } = clientFals({ intervale: [INT(1, 'monotub', 10000, 11000)] })
    st.auto = false
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('📏 Raportează'))
    await u.scrie('De la km', '11+000')
    await u.scrie('Până la km', '11+400')
    expect(u.text()).toContain('400 m monotub, km 11+000 → 11+400')
    await u.apasa(u.buton('Raportează').closest('button'))
    expect(st.rpc).toHaveLength(1)
    const c = st.rpc[0]
    expect(c.fn).toBe('fn_executie_fibra_raporteaza')
    expect(c.a).toMatchObject({ p_proiect: 1, p_tronson: 1, p_etapa: 'monotub', p_km_de_la_m: 11000, p_km_pana_la_m: 11400, p_data: AZI, p_observatii: null })
    expect(stocare.m.size).toBe(1)
    expect(JSON.parse([...stocare.m.values()][0]).cheie).toBe(c.a.p_cheie)
    await u.elibereaza(c, 'ok')
    expect(stocare.m.size).toBe(0)
    expect(u.text()).toContain('Raportat.')
    expect([...T.executie_fibra_intervale.values()].some(i => i.km_de_la_m === 11000 && i.km_pana_la_m === 11400)).toBe(true)
  })

  it('suprapunerea e oprită în formular (fără RPC); un refuz al serverului e afișat și scos din registru', async () => {
    const { client, st } = clientFals({ intervale: [INT(1, 'monotub', 10000, 10500)] })
    st.auto = false
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('📏 Raportează'))
    await u.scrie('De la km', '10+400')
    await u.scrie('Până la km', '10+600')
    expect(u.text()).toContain('Porțiunea km 10+400–10+500 e deja raportată')
    expect(u.buton('Raportează').closest('button').disabled).toBe(true)
    await u.scrie('De la km', '10+500')
    await u.apasa(u.buton('Raportează').closest('button'))
    await u.elibereaza(st.rpc[0], 'refuz')
    expect(u.text()).toContain('porțiunea km 10+400–10+500 e deja raportată')
    expect(stocare.m.size).toBe(0)
  })

  it('rezultat necunoscut: cererea rămâne în registru; „Lămurește acum” o retrimite cu ACEEAȘI cheie', async () => {
    const { client, st } = clientFals({ intervale: [INT(1, 'monotub', 10000, 11000)] })
    st.auto = false
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    await u.apasa(u.buton('📏 Raportează'))
    await u.scrie('De la km', '11+000')
    await u.scrie('Până la km', '11+200')
    await u.apasa(u.buton('Raportează').closest('button'))
    await u.elibereaza(st.rpc[0], 'eroare')
    expect(u.text()).toContain('Nu se știe dacă s-a salvat')
    expect(stocare.m.size).toBe(1)
    await u.apasa(u.buton('✕'))
    expect(u.text()).toContain('O raportare are rezultat nelămurit')
    st.auto = true
    await u.apasa(u.buton('Lămurește acum'))
    expect(st.rpc).toHaveLength(2)
    expect(st.rpc[1].a.p_cheie).toBe(st.rpc[0].a.p_cheie)
    expect(stocare.m.size).toBe(0)
    expect(u.text()).toContain('nu ajunsese; am trimis-o acum')
  })

  it('L24 (Jakarinos r1): răspunsul întârziat al unei relămuriri („activ”) nu readuce raportarea pe care reîncărcarea a arătat-o anulată', async () => {
    const { client, st, T } = clientFals()
    st.auto = false
    const stocare = stocareFalsa()
    const u = await monteaza(client, stocare)
    // 1. raportarea 10+000 → 12+000 (tot T1 = 2000 m) iese cu rezultat necunoscut (nimic scris)
    await u.apasa(u.buton('📏 Raportează'))
    await u.scrie('De la km', '10+000')
    await u.scrie('Până la km', '12+000')
    await u.apasa(u.buton('Raportează').closest('button'))
    await u.elibereaza(st.rpc[0], 'eroare')
    await u.apasa(u.buton('✕'))
    // 2. relămurirea: serverul scrie acum (instantaneu „activ”), dar răspunsul întârzie
    st.devreme = true
    await u.apasa(u.buton('Lămurește acum'))
    expect(st.rpc).toHaveLength(2)
    const scris = [...T.executie_fibra_intervale.values()].find(i => i.km_de_la_m === 10000 && i.km_pana_la_m === 12000)
    expect(scris?.stare).toBe('activ')
    // 3. între timp owner-ul o anulează, iar ↻ Reîncarcă arată anularea (monotub 0 m, rest 2.000 m)
    Object.assign(scris, { stare: 'anulat', motiv_anulare: 'raportat greșit', anulat_la: '2026-11-10T11:00:00Z', anulat_de: 'u9', anulat_nume: 'PATRON' })
    await u.apasa(u.buton('↻ Reîncarcă'))
    expect(u.text()).toContain('Anulat de PATRON: raportat greșit')
    expect(u.text()).not.toContain('100%')
    // 4. reîncărcarea de după lămurire pică (rețea), iar răspunsul vechi „activ” ajunge acum: ecranul rămâne pe anulare
    st.esueazaIntervale = true
    await u.elibereaza(st.rpc[1], 'ok')
    expect(stocare.m.size).toBe(0)
    expect(u.text()).toContain('Anulat de PATRON: raportat greșit')
    expect(u.text()).not.toContain('100%')
    expect(u.butoane().filter(b => b.textContent === 'Anulează')).toHaveLength(0)
  })

  it('anularea: doar pe raportarea proprie; blocată cât există etapa următoare peste ea', async () => {
    const { client } = clientFals({ intervale: [INT(1, 'monotub', 10000, 11000), INT(2, 'validat', 10200, 10400), INT(3, 'monotub', 11000, 11500, { raportat_de: 'u2', raportat_nume: 'ALT' })] })
    const u = await monteaza(client)
    const anuleaza = u.butoane().filter(b => b.textContent === 'Anulează')
    expect(anuleaza).toHaveLength(2)   // cele două ale lui u1; nu și cea a lui u2
    await u.apasa(anuleaza.at(-1))     // istoricul e descrescător după creat_la: ultimul = monotubul 10+000–11+000
    expect(u.text()).toContain('există „validat” raportat')
    expect(u.buton('Anulează raportarea').disabled).toBe(true)
  })

  it('doar citire: fără drept de scriere nu apar butoanele; o citire eșuată e eroare, nu listă goală', async () => {
    const { client } = clientFals({ drept: false })
    const u = await monteaza(client)
    expect(u.text()).toContain('Doar citire')
    expect(u.butoane().some(b => b.textContent.includes('Raportează'))).toBe(false)
    const { client: c2 } = clientFals({ esueazaIntervale: true })
    const u2 = await monteaza(c2)
    expect(u2.text()).toContain('Nu am putut încărca fibra optică')
  })
})
