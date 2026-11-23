// Teste de componentă pentru „📡 Radar licitații” (RadarLicitatii din OfertareLicitatii.jsx): componenta reală montată cu react-dom în
// jsdom, cu un client Supabase FALS (review #1113, P3). Fără rețea, fără librării noi. Date SINTETICE (anunțuri inventate).
// jsdom nu e dependență a proiectului (ca la src/FibraOptica.test.jsx): se caută în node_modules sau în REDARI_JSDOM_DIR.
// Fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'

// clientul fals se schimbă la fiecare test; modulul supabase.js deleagă la el
const h = vi.hoisted(() => ({ client: null }))
vi.mock('./lib/supabase.js', () => ({
  supabase: {
    from: (...a) => h.client.from(...a),
    functions: { invoke: (...a) => h.client.functions.invoke(...a) },
  },
}))
vi.mock('./App.jsx', () => ({ NotificationBell: () => null }))
// alte module importate de OfertareLicitatii.jsx își creează propriul client la încărcare (fără URL în teste): unul inert,
// orice proprietate / apel întoarce tot un obiect inert, fără rețea (Radarul folosește doar clientul fals de mai sus)
vi.mock('@supabase/supabase-js', () => {
  const inert = () => new Proxy(function () {}, {
    get: (_t, k) => (k === 'then' ? undefined : inert()),
    apply: () => inert(),
  })
  return { createClient: () => inert() }
})
import { RadarLicitatii } from './OfertareLicitatii.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[OfertareRadar.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const MESAJ = 'Lista nu a putut fi încărcată. Încearcă din nou.'
const ANUNT = (id, extra = {}) => ({ id, relevant: true, status: 'nou', scor_potrivire: 80, termen_depunere: '2099-01-10T10:00:00Z',
  titlu: `Anunț test ${id}`, autoritate: 'Autoritate test', nr_seap: `CN-TEST-${id}`, segment: 'distributie', ...extra })
const SCAN = { id: 1, pornit_la: '2026-11-16T05:00:00Z', anunturi_vazute: 12, relevante_noi: 2 }

// Imită PostgREST: from(t).select().eq().order().limit().gt() → await { data, error }; from(t).update(v).eq('id', x) → await { error }
function clientFals({ anunturi = [], scanari = [SCAN] } = {}) {
  const T = { ofertare_radar: new Map(anunturi.map(r => [r.id, { ...r }])), ofertare_radar_scan_log: new Map(scanari.map(r => [r.id, { ...r }])) }
  const st = { esueazaRadar: false, esueazaLog: false, cereri: [], actualizari: [], invocari: [], laScanare: null }
  const from = tabel => {
    const f = { eq: [], gt: null, lim: null, upd: null }
    const q = {
      select: () => q, order: () => q,
      eq: (c, v) => { f.eq.push([c, v]); return q },
      limit: n => { f.lim = n; return q }, gt: (_c, v) => { f.gt = v; return q },
      update: v => { f.upd = v; return q },
      then: (res, rej) => {
        if (f.upd) {
          st.actualizari.push({ tabel, v: f.upd, eq: f.eq })
          for (const r of T[tabel].values()) if (f.eq.every(([c, v]) => r[c] === v)) Object.assign(r, f.upd)
          return Promise.resolve({ data: null, error: null }).then(res, rej)
        }
        st.cereri.push({ tabel, gt: f.gt })
        if (tabel === 'ofertare_radar' && st.esueazaRadar) return Promise.resolve({ data: null, error: { message: 'permission denied for table ofertare_radar' } }).then(res, rej)
        if (tabel === 'ofertare_radar_scan_log' && st.esueazaLog) return Promise.resolve({ data: null, error: { message: 'permission denied for table ofertare_radar_scan_log' } }).then(res, rej)
        const date = [...T[tabel].values()].filter(r => f.eq.every(([c, v]) => r[c] === v) && (f.gt == null || r.id > f.gt))
          .sort((a, b) => a.id - b.id).slice(0, f.lim ?? Infinity).map(r => ({ ...r }))
        return Promise.resolve({ data: date, error: null }).then(res, rej)
      },
    }
    return q
  }
  const client = {
    from,
    functions: {
      invoke: async (nume, opt) => {
        st.invocari.push({ nume, opt })
        st.laScanare?.(T)
        return { data: { anunturi_vazute: 5, anunturi_noi: 1, relevante_noi: 1 }, error: null }
      },
    },
  }
  return { client, st, T }
}

let curata = []
afterEach(() => { [...curata].reverse().forEach(f => f()); curata = []; vi.restoreAllMocks() })

async function monteaza(client) {
  h.client = client
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  const showToast = vi.fn()
  await act(async () => { root.render(<RadarLicitatii profile={{ id: 'u1' }} showToast={showToast} onPromovat={() => {}} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = text => { const b = [...d.querySelectorAll('button')].filter(x => x.textContent.includes(text)).at(-1); if (!b) throw new Error('nu găsesc butonul ' + text); return b }
  const apasa = async el => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta() }
  return { d, apasa, buton, showToast, text: () => d.body.textContent }
}

const cereriRadar = st => st.cereri.filter(c => c.tabel === 'ofertare_radar').length

dom(numeDom('Radar licitații (jsdom + react-dom)'), () => {
  it('lista eșuată: mesaj fix, fără detaliul tehnic pe ecran (doar în consolă); „Reîncearcă” aduce lista', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, st } = clientFals({ anunturi: [ANUNT(1), ANUNT(2)] })
    st.esueazaRadar = true
    const u = await monteaza(client)
    expect(u.text()).toContain(MESAJ)
    expect(u.text()).not.toContain('permission denied')
    expect(u.text()).not.toContain('Nimic pe filtrul curent')
    expect(u.text()).not.toContain('Anunț test 1')
    expect(consola).toHaveBeenCalledTimes(1)
    expect(consola.mock.calls[0][1]).toMatchObject({ message: 'permission denied for table ofertare_radar' })

    st.esueazaRadar = false
    const inainte = cereriRadar(st)
    await u.apasa(u.buton('Reîncearcă'))
    expect(cereriRadar(st)).toBe(inainte + 2) // o pagină cu 2 rânduri + pagina goală
    expect(u.text()).not.toContain(MESAJ)
    expect(u.text()).toContain('Anunț test 1')
    expect(u.text()).toContain('Anunț test 2')
    expect(u.text()).toContain('afișate 2 din 2')
  })

  it('o reîncărcare eșuată după succes nu lasă lista veche pe ecran', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, st } = clientFals({ anunturi: [ANUNT(1)] })
    const u = await monteaza(client)
    expect(u.text()).toContain('Anunț test 1')
    st.esueazaRadar = true
    await u.apasa(u.buton('Scanează acum'))
    expect(u.text()).toContain(MESAJ)
    expect(u.text()).not.toContain('Anunț test 1')
  })

  it('eroare doar la jurnalul de scanare: lista se afișează, „ultima scanare: necunoscută”', async () => {
    const avert = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client, st } = clientFals({ anunturi: [ANUNT(1)] })
    st.esueazaLog = true
    const u = await monteaza(client)
    expect(u.text()).toContain('Anunț test 1')
    expect(u.text()).toContain('ultima scanare: necunoscută')
    expect(u.text()).not.toContain(MESAJ)
    expect(u.text()).not.toContain('permission denied')
    expect(avert).toHaveBeenCalledTimes(1)
  })

  it('jurnalul citit: ultima scanare cu cifrele ei, fără „necunoscută”', async () => {
    const { client } = clientFals({ anunturi: [ANUNT(1)] })
    const u = await monteaza(client)
    expect(u.text()).toContain('12 anunțuri, 2 relevante noi')
    expect(u.text()).not.toContain('necunoscută')
  })

  it('„Scanează acum”: pornește scanarea, apoi reîncarcă lista (anunțul nou apare)', async () => {
    const { client, st } = clientFals({ anunturi: [ANUNT(1)] })
    st.laScanare = T => { T.ofertare_radar.set(3, ANUNT(3)) }
    const u = await monteaza(client)
    expect(u.text()).not.toContain('Anunț test 3')
    await u.apasa(u.buton('Scanează acum'))
    expect(st.invocari).toEqual([{ nume: 'ofertare-radar-scan', opt: { body: { zile: 2 } } }])
    expect(u.text()).toContain('Anunț test 3')
    expect(u.text()).toContain('afișate 2 din 2')
    expect(u.showToast).toHaveBeenCalledWith('📡 Scanat: 5 anunțuri, 1 noi, 1 relevante.')
  })

  it('acțiune „Ignoră”: scrie starea, apoi reîncarcă lista (anunțul iese din „Noi + interesante”)', async () => {
    const { client, st } = clientFals({ anunturi: [ANUNT(1), ANUNT(2)] })
    const u = await monteaza(client)
    const inainte = cereriRadar(st)
    const card = [...u.d.querySelectorAll('button')].filter(b => b.textContent.includes('Ignoră'))
    expect(card.length).toBe(2)
    await u.apasa(card[0])
    expect(st.actualizari.length).toBe(1)
    expect(st.actualizari[0]).toMatchObject({ tabel: 'ofertare_radar', v: { status: 'ignorat' }, eq: [['id', 1]] })
    expect(cereriRadar(st)).toBeGreaterThan(inainte)
    expect(u.text()).not.toContain('Anunț test 1')
    expect(u.text()).toContain('Anunț test 2')
  })
})
