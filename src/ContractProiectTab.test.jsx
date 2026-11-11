// Teste de componentă pentru ContractProiectTab: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS ale cărui
// răspunsuri se eliberează manual (ordinea e controlată de test). Fără rețea, fără librării noi.
// jsdom nu e dependență a proiectului (ca la NodCuplareSchema.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR. Fără el,
// suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { vi } from 'vitest'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import ContractProiectTab from './ContractProiectTab.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[ContractProiectTab.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const amana = () => { let res; const p = new Promise(r => { res = r }); return { p, res } }
const EV = (id, cod, extra = {}) => ({
  id, proiect_id: 1, sectiune: 'eveniment', cod, ordine: 0, titlu: `Eveniment ${cod}`, clauze: '38.5', continut: 'fapt', citat: null, conditie: null, dovezi: null,
  dovezi_lipsa: null, termen_text: null, efect: null, data_eveniment: null, notificare: null, raspuns: null, stare: 'de_notificat', termen_urmator: '2099-01-10',
  termen_ce: null, putere: null, sursa: null, activ: true, versiune: 1, modificat_la: '2026-11-09T10:00:00Z', ...extra,
})

// clientul fals: serverul = hartă de rânduri pe proiect; citirea listei se poate ține la poartă; RPC-ul de salvare se eliberează manual
function clientFals({ randuri, drept = true }) {
  const server = new Map(randuri.map(r => [r.id, { ...r }]))
  const st = { poarta: null, rpc: [], cereriLista: 0 }
  let urmId = 1000
  const client = {
    from: () => {
      const f = { pid: null, gt: null }
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c, v) => { if (c === 'proiect_id') f.pid = v; return q },
        gt: (_c, v) => { f.gt = v; return q },
        then: (res, rej) => {
          st.cereriLista += 1
          const instant = [...server.values()].filter(r => r.proiect_id === f.pid && (f.gt == null || r.id > f.gt)).sort((a, b) => a.id - b.id).map(r => ({ ...r }))
          const poarta = f.gt == null ? st.poarta : null
          return (poarta ? poarta.p : Promise.resolve()).then(() => ({ data: instant, error: null })).then(res, rej)
        },
      }
      return q
    },
    rpc: (fn, a) => {
      if (fn === 'fn_executie_contract_drept') return (st.poartaDrept ? st.poartaDrept.p : Promise.resolve()).then(() => ({ data: drept, error: null }))
      const d = amana(); st.rpc.push({ a, ...d })
      return d.p.then(mod => {
        if (mod === 'retea') return { data: null, error: { message: 'Failed to fetch' } }
        if (a.p_id == null) {
          const r = { ...EV(++urmId, a.p_date.cod), ...a.p_date, id: urmId, proiect_id: a.p_proiect, versiune: 1 }
          server.set(r.id, r)
          return { data: { ok: true, duplicat: false, rand: { ...r } }, error: null }
        }
        const r = server.get(a.p_id)
        if (r.versiune !== a.p_versiune) return { data: { ok: false, motiv: 'conflict', rand: { ...r } }, error: null }
        Object.assign(r, a.p_date, { versiune: r.versiune + 1 })
        return { data: { ok: true, duplicat: false, rand: { ...r } }, error: null }
      })
    },
  }
  return { client, st, server }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = [] })

async function monteaza(client, proiectId = 1) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }) }
  const randeaza = async pid => { await act(async () => { root.render(<ContractProiectTab proiectId={pid} client={client} />) }); await asteapta() }
  await randeaza(proiectId)
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = text => { const b = [...d.querySelectorAll('button')].filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  const scrie = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta()
  }
  const elibereaza = async (cerere, val) => { await act(async () => { cerere.res(val) }); await asteapta() }
  const campTitlu = () => [...d.querySelectorAll('[role="dialog"] label')].find(l => l.textContent === 'Titlu').nextElementSibling
  return { d, buton, apasa, scrie, elibereaza, randeaza, campTitlu, asteapta }
}

dom(numeDom('ContractProiectTab (jsdom + react-dom)'), () => {
  it('fără drept de scriere: lista și rezumatul se văd, butoanele de scriere nu', async () => {
    const { client } = clientFals({ randuri: [EV(1, 'E01'), EV(2, 'E02', { stare: 'decazut' })], drept: false })
    const u = await monteaza(client)
    expect(u.d.body.textContent).toContain('Eveniment E01')
    expect(u.d.body.textContent).toContain('Următoarele termene')
    expect(u.d.body.textContent).not.toContain('＋ Adaugă')
    await u.apasa(u.buton('Eveniment E01'))
    expect(u.d.body.textContent).not.toContain('Editează')
  })

  it('rând nou: payload doar cu câmpurile secțiunii; eroarea de rețea păstrează cheia la reîncercare (L04/L05)', async () => {
    const { client, st } = clientFals({ randuri: [EV(1, 'E01')] })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Adaugă'))
    await u.scrie(u.campTitlu(), 'Ordin de suspendare test')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(1)
    const a1 = st.rpc[0].a
    expect(a1.p_id).toBeNull(); expect(a1.p_versiune).toBeNull()
    expect(a1.p_date).toMatchObject({ sectiune: 'eveniment', cod: 'E02', titlu: 'Ordin de suspendare test', stare: 'de_notificat', activ: true })
    expect(Object.keys(a1.p_date)).not.toContain('citat')
    await u.elibereaza(st.rpc[0], 'retea')
    expect(u.d.body.textContent).toContain('Rezultat necunoscut')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc).toHaveLength(2)
    expect(st.rpc[1].a.p_cheie).toBe(a1.p_cheie)
    await u.elibereaza(st.rpc[1], 'ok')
    expect(u.d.querySelector('[role="dialog"]')).toBeNull()
    expect(u.d.body.textContent).toContain('Ordin de suspendare test')
  })

  it('conflict de versiune: mesaj, formularul se reîncarcă din rândul serverului, nimic nu se suprascrie', async () => {
    const { client, st, server } = clientFals({ randuri: [EV(1, 'E01')] })
    const u = await monteaza(client)
    await u.apasa(u.buton('Eveniment E01'))
    await u.apasa(u.buton('Editează'))
    server.get(1).titlu = 'schimbat de altcineva'; server.get(1).versiune = 2
    await u.scrie(u.campTitlu(), 'versiunea mea')
    await u.apasa(u.buton('Salvează'))
    expect(st.rpc[0].a).toMatchObject({ p_id: 1, p_versiune: 1 })
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('modificat între timp')
    expect(u.campTitlu().value).toBe('schimbat de altcineva')
    expect(server.get(1).titlu).toBe('schimbat de altcineva')
  })

  it('review r1 P2: un rând salvat cât rulează o citire pornită înainte rămâne în listă după ce citirea se termină', async () => {
    const { client, st } = clientFals({ randuri: [EV(1, 'E01')] })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Adaugă'))
    await u.scrie(u.campTitlu(), 'Salvat în timpul citirii')
    st.poartaDrept = amana()
    await u.apasa(u.buton('↻ Reîncarcă'))          // lista se citește complet ACUM (fără rândul nou), dar aplicarea așteaptă verificarea dreptului
    await u.apasa(u.buton('Salvează'))
    await u.elibereaza(st.rpc[0], 'ok')
    expect(u.d.body.textContent).toContain('Salvat în timpul citirii')
    await u.elibereaza(st.poartaDrept, undefined)    // citirea veche (fără rândul nou) se aplică după salvare
    expect(u.d.body.textContent).toContain('Salvat în timpul citirii')
    expect(u.d.body.textContent).toContain('Eveniment E01')
  })

  it('review r1 P2: o salvare blocată pe proiectul vechi nu blochează formularul pe proiectul nou', async () => {
    const { client, st } = clientFals({ randuri: [EV(1, 'E01'), EV(2, 'E77', { proiect_id: 2, titlu: 'Doar pe proiectul 2' })] })
    const u = await monteaza(client)
    await u.apasa(u.buton('＋ Adaugă'))
    await u.scrie(u.campTitlu(), 'Pe proiectul 1')
    await u.apasa(u.buton('Salvează'))
    expect(u.d.body.textContent).toContain('Se salvează…')
    await u.randeaza(2)                              // salvarea pe P1 e încă în așteptare
    await u.apasa(u.buton('＋ Adaugă'))
    expect(u.buton('Salvează').disabled).toBe(false)
    expect(u.buton('Renunță').disabled).toBe(false)
    await u.elibereaza(st.rpc[0], 'ok')              // abia acum se termină salvarea veche
    expect(u.d.body.textContent).not.toContain('Pe proiectul 1')
    expect(u.buton('Salvează').disabled).toBe(false)
  })

  it('L24: o citire întârziată a proiectului vechi nu ajunge pe proiectul nou', async () => {
    const { client, st } = clientFals({ randuri: [EV(1, 'E01'), EV(2, 'E77', { proiect_id: 2, titlu: 'Doar pe proiectul 2' })] })
    const u = await monteaza(client)
    st.poarta = amana()
    await u.apasa(u.buton('↻ Reîncarcă'))          // citirea proiectului 1 rămâne la poartă
    const veche = st.poarta
    st.poarta = null
    await u.randeaza(2)                              // trecem pe proiectul 2
    expect(u.d.body.textContent).toContain('Doar pe proiectul 2')
    await u.elibereaza(veche, undefined)             // abia acum ajunge citirea veche
    expect(u.d.body.textContent).not.toContain('Eveniment E01')
    expect(u.d.body.textContent).toContain('Doar pe proiectul 2')
  })
})
