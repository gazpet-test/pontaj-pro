// Teste de componentă pentru TabMeteoIstoric: componenta reală montată cu react-dom în jsdom, cu un client Supabase FALS (tabele în
// memorie). jsdom se caută în node_modules sau în REDARI_JSDOM_DIR (tiparul din NodCuplareSchema.test.jsx); fără el, suita e SĂRITĂ VIZIBIL.
import React from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
vi.mock('./lib/supabase.js', () => ({ supabase: null }))
import TabMeteoIstoric from './TabMeteoIstoric.jsx'

let JSDOM = null
const surse = [import.meta.url, process.env.REDARI_JSDOM_DIR && path.join(process.env.REDARI_JSDOM_DIR, 'package.json')].filter(Boolean)
for (const s of surse) { try { JSDOM = createRequire(s)('jsdom').JSDOM; break } catch { /* următoarea sursă */ } }
const MOTIV_SARIT = 'SĂRIT: lipsește jsdom (nu e dependență a proiectului; rulează cu REDARI_JSDOM_DIR=<dir cu jsdom instalat>)'
if (!JSDOM) console.warn(`[TabMeteoIstoric.test] ${MOTIV_SARIT}`)
const dom = JSDOM ? describe : describe.skip
const numeDom = t => (JSDOM ? t : `${t} — ${MOTIV_SARIT}`)

const zi = (site_id, data, o = {}) => ({ site_id, data, precipitatii_mm: 0, ploaie_mm: 0, zapada_cm: 0, tmin_c: 1, tmax_c: 8, vant_max_kmh: 10, rafale_max_kmh: 20,
  cod_vreme: 3, lat: 44.6, lng: 22.6, sursa: 'open-meteo-archive', preluat_la: '2026-11-10T04:05:00Z', zi_nelucrabila: false, motive: [],
  precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, praguri_versiune: 1, ...o })
const TABELE = () => ({
  sites: [{ id: 1, name: 'Lot 1', lat: 44.6, lng: 22.6, meteo_activ: true, active: true, proiect_id: 5 },
    { id: 2, name: 'Lot 2', lat: 44.7, lng: 22.4, meteo_activ: true, active: false, proiect_id: 5 },          // închis, cu istoric
    { id: 9, name: 'Alt proiect', lat: 45, lng: 23, meteo_activ: true, active: true, proiect_id: 6 }],
  meteo_praguri_nelucrabil: [{ id: 1, precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, versiune: 1, actualizat_la: '2026-11-09T10:00:00Z' }],
  meteo_praguri_jurnal: [{ versiune: 1, precipitatii_mm_min: 10, zapada_cm_min: 1, tmax_sub_c: 0, tmin_max_c: -5, actualizat_la: '2026-11-09T10:00:00Z' }],
  profiles: [{ id: 'u-owner', is_owner: true }, { id: 'u-alt', is_owner: false }],
  v_meteo_zile: [zi(1, '2026-01-02', { zi_nelucrabila: true, motive: ['precipitatii'], precipitatii_mm: 12.4 }), zi(1, '2026-01-03'), zi(1, '2026-01-04', { zi_nelucrabila: null, precipitatii_mm: null }),
    zi(2, '2026-01-10', { zi_nelucrabila: true, motive: ['zapada'], zapada_cm: 3 })],
})
function clientFals({ tabele = TABELE(), user = 'u-alt', eroare = null, rpc = null, functie = null } = {}) {
  const apeluri = []
  return {
    apeluri,
    auth: { getUser: async () => ({ data: { user: user ? { id: user } : null } }) },
    rpc: async (fn, args) => { apeluri.push([fn, args]); return rpc ? rpc(fn, args) : { data: 2, error: null } },
    functions: { invoke: async (fn, opt) => { apeluri.push([fn, opt.body]); return functie ? functie(fn, opt.body) : { data: null, error: { message: 'nedefinit' } } } },
    from(t) {
      const f = []; let single = false, ord = null, lim = Infinity
      const exec = () => {
        const e = eroare && eroare(t)
        if (e) return { data: null, error: { message: e } }
        let rows = (tabele[t] || []).filter(r => f.every(x => x(r)))
        if (ord) rows = [...rows].sort((a, b) => (a[ord] < b[ord] ? -1 : 1))
        rows = rows.slice(0, lim)
        return single ? { data: rows[0] || null, error: null } : { data: rows, error: null }
      }
      const api = {
        select() { return api }, eq(c, v) { f.push(r => r[c] === v); return api }, gte(c, v) { f.push(r => r[c] >= v); return api },
        lte(c, v) { f.push(r => r[c] <= v); return api }, gt(c, v) { f.push(r => r[c] > v); return api },
        order(c) { ord = c; return api }, limit(n) { lim = n; return api }, maybeSingle() { single = true; return api },
        then(res, rej) { return Promise.resolve().then(exec).then(res, rej) },
      }
      return api
    },
  }
}

let curata = []
afterEach(() => { curata.forEach(f => f()); curata = []; vi.restoreAllMocks() })
async function monteaza(client, proiectId = 5) {
  const j = new JSDOM('<!doctype html><div id="r"></div>', { pretendToBeVisual: true })
  const vechi = { window: globalThis.window, document: globalThis.document }
  Object.assign(globalThis, { window: j.window, document: j.window.document })
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const descarcari = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:test')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  j.window.HTMLAnchorElement.prototype.click = function () { descarcari.push(this.download) }
  const { createRoot } = await import('react-dom/client')
  const act = React.act || (await import('react-dom/test-utils')).act
  const root = createRoot(j.window.document.getElementById('r'))
  const d = j.window.document
  const asteapta = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }) }
  await act(async () => { root.render(<TabMeteoIstoric proiectId={proiectId} codProiect="LOT1" client={client} />) })
  await asteapta()
  curata.push(() => { act(() => root.unmount()); Object.assign(globalThis, vechi) })
  const buton = (text) => [...d.querySelectorAll('button')].find(b => b.textContent.includes(text))
  const apasa = async (el) => { await act(async () => { el.dispatchEvent(new j.window.MouseEvent('click', { bubbles: true })) }); await asteapta(); await asteapta() }
  // JSZip lucrează cu temporizatoare: se așteaptă în timp real (cel mult ~5 s) până la condiție
  const asteaptaPana = async (cond) => { for (let i = 0; i < 250 && !cond(); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }
  const alege = async (el, val) => {
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set
    await act(async () => { set.call(el, val); el.dispatchEvent(new j.window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
    await asteapta(); await asteapta()
  }
  const stare = (z) => d.querySelector(`[data-zi="${z}"]`)?.getAttribute('data-stare')
  return { d, buton, apasa, descarcari, asteapta, asteaptaPana, alege, stare, act }
}

dom(numeDom('TabMeteoIstoric'), () => {
  it('calendarul lunii cu date: nelucrabilă / lucrabilă / necunoscută / fără date; rezumatul și detaliile zilei', async () => {
    const u = await monteaza(clientFals())
    const stare = (z) => u.d.querySelector(`[data-zi="${z}"]`)?.getAttribute('data-stare')
    expect(u.d.body.textContent).toContain('ianuarie 2026')            // luna curentă n-are date → ultima lună cu date
    expect([stare('2026-01-02'), stare('2026-01-03'), stare('2026-01-04'), stare('2026-01-05')]).toEqual(['DA', 'NU', 'necunoscut', 'fara'])
    expect(u.d.querySelector('[data-meteo-rezumat]').textContent).toContain('1 nelucrabile din 3 zile cu date · 1 necunoscute · 28 fără date')
    await u.apasa(u.d.querySelector('[data-zi="2026-01-02"]'))
    expect(u.d.querySelector('[data-meteo-detalii]').textContent).toContain('zi nelucrabilă')
    expect(u.d.querySelector('[data-meteo-detalii]').textContent).toContain('precipitații 12,4 mm ≥ 10')
    expect(u.d.body.textContent).not.toContain('Alt proiect')             // doar șantierele proiectului (sites.proiect_id)
  })
  it('pragurile: non-owner nu le poate schimba; owner-ul trimite versiunea citită (CAS) și vede eroarea serverului', async () => {
    const a = await monteaza(clientFals({ user: 'u-alt' }))
    expect(a.buton('Schimbă pragurile')).toBeUndefined()
    curata.forEach(f => f()); curata = []
    const c = clientFals({ user: 'u-owner', rpc: () => ({ data: null, error: { message: 'pragurile au fost schimbate între timp — reîncarcă pagina' } }) })
    const u = await monteaza(c)
    await u.apasa(u.buton('Schimbă pragurile'))
    await u.apasa(u.buton('Salvează'))
    expect(c.apeluri).toEqual([['fn_meteo_praguri_seteaza', { p_versiune: 1, p_precipitatii_mm: 10, p_zapada_cm: 1, p_tmax_sub_c: 0, p_tmin_max_c: -5 }]])
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('schimbate între timp')
  })
  it('completarea istoricului: doar owner-ul vede butonul; rezultatul funcției se afișează (zile scrise / motivul unui refuz)', async () => {
    const a = await monteaza(clientFals({ user: 'u-alt' }))
    expect(a.d.querySelector('[data-meteo-completeaza]')).toBe(null)
    curata.forEach(f => f()); curata = []
    const c = clientFals({ user: 'u-owner', functie: () => ({ data: { ok: true, istoric: { ok: true, rez: [{ site: 1, de: '2025-05-05', pana: '2026-11-08', zile_scrise: 553, lipsa: 0, respinse: 1, ok: true }], sarite: [] } }, error: null }) })
    const u = await monteaza(c)
    await u.apasa(u.d.querySelector('[data-meteo-completeaza]'))
    expect(c.apeluri).toContainEqual(['meteo-sync', { istoric_backfill: true, site_id: 1 }])
    expect(u.d.querySelector('[data-meteo-completare]').textContent).toBe('553 zile scrise (05.05.2025 – 08.11.2026) · 1 respinse la validare')
    curata.forEach(f => f()); curata = []
    const c2 = clientFals({ user: 'u-owner', functie: () => ({ data: { ok: true, istoric: { ok: true, rez: [], sarite: [{ site_id: 1, motiv: 'fără dată de început (proiect fără data_start; se poate da de_la)' }] } }, error: null }) })
    const u2 = await monteaza(c2)
    await u2.apasa(u2.d.querySelector('[data-meteo-completeaza]'))
    expect(u2.d.querySelector('[data-meteo-completare]').textContent).toContain('Nu s-a completat: fără dată de început')
  })
  it('șantierul închis rămâne în selector, cu istoric consultabil și exportabil; fără completare (review r1 P1)', async () => {
    const u = await monteaza(clientFals({ user: 'u-owner' }))
    const sel = u.d.querySelector('select')
    expect([...sel.options].map(o => o.textContent)).toEqual(['Lot 1', 'Lot 2 (închis)'])
    expect(sel.value).toBe('1')                                            // implicit: primul șantier activ
    await u.alege(sel, '2')
    expect(u.stare('2026-01-10')).toBe('DA')
    expect(u.d.body.textContent).toContain('Șantier închis')
    expect(u.d.querySelector('[data-meteo-completeaza]')).toBe(null)
    await u.apasa(u.d.querySelector('[data-meteo-export]'))
    await u.asteaptaPana(() => u.descarcari.length > 0)
    expect(u.d.body.textContent).toContain('✓ 4 zile exportate')          // 3 de pe Lot 1 + 1 de pe Lot 2 (închis)
  })
  it('completare pe A → schimbare pe B → răspunsul lui A → înapoi pe A: butonul e utilizabil, fără mesajul vechi (review r2 P2)', async () => {
    let elib
    const tabele = TABELE()
    tabele.sites[1].active = true                                        // B activ, ca să aibă și el butonul
    const c = clientFals({ tabele, user: 'u-owner', functie: () => new Promise(r => { elib = r }) })
    const u = await monteaza(c)
    await u.apasa(u.d.querySelector('[data-meteo-completeaza]'))
    expect(u.d.querySelector('[data-meteo-completeaza]').disabled).toBe(true)
    await u.alege(u.d.querySelector('select'), '2')
    expect(u.d.querySelector('[data-meteo-completeaza]').disabled).toBe(false)   // pe B nu e nicio completare în curs
    expect(u.d.querySelector('[data-meteo-completare]')).toBe(null)
    await u.act(async () => { elib({ data: { ok: true, istoric: { ok: true, rez: [{ site: 1, de: '2025-05-05', pana: '2026-11-08', zile_scrise: 5, lipsa: 0, respinse: 0, absente: 0, ok: true }], sarite: [] } }, error: null }) })
    await u.asteapta(); await u.asteapta()
    expect(u.d.querySelector('[data-meteo-completare]')).toBe(null)        // răspunsul lui A nu se afișează pe B
    await u.alege(u.d.querySelector('select'), '1')
    expect(u.d.querySelector('[data-meteo-completeaza]').disabled).toBe(false)
    expect(u.d.querySelector('[data-meteo-completare]')).toBe(null)
  })
  it('pragul gol nu devine 0: refuz în formular, fără apel la server (review r1 P2)', async () => {
    const c = clientFals({ user: 'u-owner' })
    const u = await monteaza(c)
    await u.apasa(u.buton('Schimbă pragurile'))
    const inp = [...u.d.querySelectorAll('input')]
    await u.alege(inp[3], '   ')                                          // Tmin golit
    await u.apasa(u.buton('Salvează'))
    expect(c.apeluri.filter(a => a[0] === 'fn_meteo_praguri_seteaza')).toEqual([])
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('cel mult o zecimală')
    await u.alege(inp[3], '-5,55')
    await u.apasa(u.buton('Salvează'))
    expect(c.apeluri.filter(a => a[0] === 'fn_meteo_praguri_seteaza')).toEqual([])
  })
  it('salvarea pragurilor întârziată + schimbarea șantierului: calendarul arată șantierul ales ACUM (review r1 P1, L24)', async () => {
    let elib
    const c = clientFals({ user: 'u-owner', rpc: () => new Promise(r => { elib = r }) })
    const u = await monteaza(c)
    await u.apasa(u.buton('Schimbă pragurile'))
    await u.apasa(u.buton('Salvează'))                                    // RPC-ul rămâne în așteptare
    await u.alege(u.d.querySelector('select'), '2')
    expect(u.stare('2026-01-10')).toBe('DA')
    await u.act(async () => { elib({ data: 2, error: null }) })
    await u.asteapta(); await u.asteapta(); await u.asteapta()
    expect(u.d.querySelector('select').value).toBe('2')
    expect(u.stare('2026-01-10')).toBe('DA')                              // tot Lot 2 …
    expect(u.stare('2026-01-02')).toBe('fara')                            // … nu zilele lui Lot 1
  })
  it('eroarea la citirea istoricului se afișează (L18), nu un calendar gol', async () => {
    const u = await monteaza(clientFals({ eroare: t => t === 'v_meteo_zile' && 'permission denied' }))
    expect(u.d.querySelector('[role="alert"]').textContent).toContain('istoricul meteo nu se poate citi: permission denied')
  })
  it('exportul descarcă fișierul cu toate zilele șantierelor proiectului', async () => {
    const u = await monteaza(clientFals())
    await u.apasa(u.d.querySelector('[data-meteo-export]'))
    await u.asteaptaPana(() => u.descarcari.length > 0)
    expect(u.descarcari.length).toBe(1)
    expect(u.descarcari[0]).toMatch(/^Meteo_zile_nelucrabile_LOT1_\d{2}\.\d{2}\.\d{4}\.xlsx$/)
    expect(u.d.body.textContent).toContain('✓ 4 zile exportate')          // și ziua șantierului închis
  })
  it('proiect fără șantiere legate: mesaj, fără calendar', async () => {
    const u = await monteaza(clientFals(), 77)
    expect(u.d.body.textContent).toContain('Proiectul nu are șantiere legate în ERP')
    expect(u.d.querySelector('[data-meteo-calendar]')).toBe(null)
  })
})
