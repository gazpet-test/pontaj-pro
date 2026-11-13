// r4 + r5 — handler-ul meteo-sync (supabase/functions/meteo-sync/index.ts) rulat ÎNTREG, cu BD și rețea simulate (rețeaua întoarce și
// antetele de cost / cotă ale Xweather). r4: țintele, plafonul, numărătoarea eșecurilor, termenul pasului, fără reverificare automată,
// comanda owner-ului doar a owner-ului (403). r5: costul din antete (sau estimat) pentru TOATE cererile Xweather, blocul `cota`, întrerupătorul
// XW_ZILNIC_ACTIV, garda de cotă, 429 pe coduri, 200 cu maxhits în corp, termenul global, fereastra + „nimic de făcut”, XW_AER_PE_ZI.
// Mutanții (copii stricate intenționat ale index.ts / logicii) TREBUIE să pice (L25). Copiile se scriu într-un folder temporar (importul
// npm:@supabase/supabase-js e înlocuit cu clientul simulat), apoi se șterg. Valorile așteptate sunt scrise de mână (multiplicatorii din
// documentația oficială Xweather: conditions / forecasts / alerts / conditions/summary = 1, airquality = 5).
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = new URL('../supabase/functions/meteo-sync/', import.meta.url)
const citeste = (f) => readFileSync(new URL(f, DIR), 'utf8').replace(/\r\n/g, '\n')
const INDEX = citeste('index.ts')
const LOGICA = citeste('xweather_zilnic_logica.ts')
const COTA = citeste('xweather_cota_logica.ts')
const ISTORIC = citeste('istoric_logica.ts')
const IMPORT_SUPA = "import { createClient } from 'npm:@supabase/supabase-js@2';"
const TMP = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'xw-handler-')))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const ENV_BAZA = { SUPABASE_URL: 'http://bd.test', SUPABASE_SERVICE_ROLE_KEY: 'cheie-serviciu', SUPABASE_ANON_KEY: 'cheie-anon', XW_ZILNIC_ACTIV: '1' }
let n = 0
async function incarcaHandler({ index = INDEX, logica = LOGICA, cota = COTA, env = {} } = {}) {
  if (!index.includes(IMPORT_SUPA)) throw new Error('importul supabase-js s-a schimbat')
  const d = path.join(TMP, `h${n++}`)
  mkdirSync(d)
  writeFileSync(path.join(d, 'index.ts'), index.replace(IMPORT_SUPA, 'const { createClient } = (globalThis as any).__xwSupabase;'))
  writeFileSync(path.join(d, 'xweather_zilnic_logica.ts'), logica)
  writeFileSync(path.join(d, 'xweather_cota_logica.ts'), cota)
  writeFileSync(path.join(d, 'istoric_logica.ts'), ISTORIC)
  const E = { ...ENV_BAZA, ...env }
  let handler = null
  globalThis.Deno = { serve: (h) => { handler = h }, env: { get: (k) => (E[k] === undefined ? undefined : E[k]) } }
  await import(/* @vite-ignore */ pathToFileURL(path.join(d, 'index.ts')).href)
  if (!handler) throw new Error('Deno.serve nu a fost apelat')
  return handler
}
function mutant(text, inlocuiri) {
  let t = text
  for (const [din, in_] of inlocuiri) {
    if (!t.includes(din)) throw new Error('mutantul nu găsește textul: ' + din.slice(0, 80))
    t = t.split(din).join(in_)
  }
  return t
}

// ── BD simulată: interogările folosite de funcție (select / eq / gte / lte / gt / in / order / limit / maybeSingle / insert / upsert) ──
const SECRET = 'secret-cron-test'
function stare({ sites, rapoarte = [], vreme = [], profiles = [], useri = {} }) {
  return {
    tabele: { sites, executie_proiecte: [], rapoarte_zilnice: rapoarte.map((r, i) => ({ id: i + 1, ...r })), v_meteo_zilnic_xweather: vreme, profiles },
    scrise: {}, citite: [], useri, zilnic: [], curente: 0, curenteEp: [], openMeteo: 0, timpi: [],
    rpc: { meteo_cron_secret: SECRET, meteo_xweather_creds: { client_id: 'ID', client_secret: 'SEC' } },
    // r6: fiecare „thenable” al bazei (builder / rpc / auth) își numără consumările; agata(eticheta, nr) = acel apel nu se mai termină
    consumari: [], apeluri: {}, agata: null,
  }
}
// r6: un „thenable” leneș ca builderul supabase-js: fiecare `then` = o cerere (consumare); agățat = nu se termină niciodată
function thenable(st, eticheta, exec) {
  const nr = (st.apeluri[eticheta] = (st.apeluri[eticheta] || 0) + 1)
  const c = { eticheta, n: 0 }
  st.consumari.push(c)
  return (ok, err) => {
    c.n++
    if (st.agata?.(eticheta, nr)) return new Promise(() => {})
    return Promise.resolve().then(exec).then(ok, err)
  }
}
function clientSimulat(st) {
  return (_url, _cheie, opt) => {
    const tok = (opt?.global?.headers?.Authorization || '').replace(/^Bearer /, '')
    const from = (nume) => {
      const filtre = []
      // r7: mai multe .order() = chei succesive (ca PostgREST)
      const ordine = []
      let limita = null, unic = false, scriere = null, then = null
      const exec = () => {
        if (scriere) { (st.scrise[nume] ||= []).push(...[].concat(scriere)); return { data: null, error: null } }
        st.citite.push(nume)
        let rows = (st.tabele[nume] || []).filter(r => filtre.every(f => f(r)))
        if (ordine.length) rows = [...rows].sort((a, b) => {
          for (const [c, asc] of ordine) { const d = a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0; if (d) return asc ? d : -d }
          return 0
        })
        if (limita != null) rows = rows.slice(0, limita)
        return unic ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
      }
      const q = {
        select: () => q,
        eq: (c, v) => (filtre.push(r => r[c] === v), q),
        gte: (c, v) => (filtre.push(r => r[c] >= v), q),
        lte: (c, v) => (filtre.push(r => r[c] <= v), q),
        gt: (c, v) => (filtre.push(r => r[c] > v), q),
        lt: (c, v) => (filtre.push(r => r[c] < v), q),
        in: (c, vs) => (filtre.push(r => vs.includes(r[c])), q),
        order: (c, o = {}) => (ordine.push([c, o.ascending !== false]), q),
        limit: (k) => ((limita = k), q),
        maybeSingle: () => ((unic = true), q),
        insert: (row) => ((scriere = row), q),
        upsert: (row) => ((scriere = row), q),
        // eticheta se fixează la prima consumare: „scrie:<tabel>” sau „from:<tabel>”
        then: (ok, err) => (then ||= thenable(st, (scriere ? 'scrie:' : 'from:') + nume, exec))(ok, err),
      }
      return q
    }
    const rpc = (f) => ({ then: thenable(st, 'rpc:' + f, () => ({ data: st.rpc[f] ?? null, error: null })) })
    return {
      from, rpc,
      auth: { getUser: () => ({ then: thenable(st, 'auth:getUser', () => ({ data: { user: st.useri[tok] ? { id: st.useri[tok] } : null } })) }) },
    }
  }
}

// ── rețeaua simulată: Xweather (vremea zilei + vremea curentă, cu antetele de cost / cotă), Open-Meteo ──
const XW = 'https://data.api.xweather.com/'
// costurile documentate (sursa independentă de cod: paginile oficiale Xweather citate în docs/METEO_XWEATHER_COTA.md)
const COST_DOC = { conditions: 1, forecasts: 1, alerts: 1, airquality: 5, 'conditions/summary': 1, 'observations/summary': 1 }
const RESET_PERIOADA = '2026-11-30T00:00:00Z'   // 17 zile după 13.11 04:05 UTC (rotunjit în sus)
const cota = (rest = 90000, extra = {}) => ({ 'X-RateLimit-Limit-Period': '100000', 'X-RateLimit-Remaining-Period': String(rest),
  'X-RateLimit-Reset-Period': RESET_PERIOADA, 'X-RateLimit-Limit-Period-Type': 'month', 'X-RateLimit-Limit-Minute': '1000',
  'X-RateLimit-Remaining-Minute': '990', ...extra })
const anteteImplicite = ({ ep, status }) => ({ ...(status >= 200 && status < 300 ? { 'X-Cost-Tokens': String(COST_DOC[ep]), 'X-Cost-Endpoint': ep } : {}), ...cota() })
const json = (o, status = 200, antete = {}) => new Response(JSON.stringify(o), { status, headers: antete })
const condOk = (zi) => ({ success: true, error: null, response: [{ loc: { lat: 44, long: 26 }, profile: { tz: 'Europe/Bucharest' },
  periods: [{ dateTimeISO: `${zi}T00:00:00+02:00`, temp: { minC: 1, maxC: 9, avgC: 5 }, precip: { totalMM: 2 } }] }] })
const obsOk = (zi) => ({ success: true, error: null, response: [{ id: 'LRBS', place: { name: 'Baneasa' }, relativeTo: { distanceKM: 12 },
  loc: { lat: 44.5, long: 26.08 }, periods: [{ summary: { dateTimeISO: `${zi}T00:00:00+02:00` } }] }] })
const curentOk = { success: true, error: null, response: [{ periods: [{ tempC: 5, weather: 'Cloudy' }] }] }
const epCurent = (c) => /^([a-z]+)\//.exec(c)[1]
// raspuns({ ep, site, zi }) → 'ok' | 'retea' | { status, json, antete? } (vremea zilei); curent({ ep }) → idem (vremea curentă);
// pasMs / curentPasMs / omPasMs = cât „durează” o cerere (ceasul simulat avansează)
// r6: agataRetea(url) = 'cerere' (fetch-ul nu se mai termină) | 'corp' (antetele vin, corpul nu se mai termină) | null; omOk = arhiva
// Open-Meteo răspunde valid (altfel 503)
const corpAgatat = (status, antete = {}) => new Response(new ReadableStream({ start() {} }), { status, headers: antete })
function arhivaOk(u) {
  const q = new URL(u).searchParams
  const zile = []
  for (let d = q.get('start_date'); d <= q.get('end_date'); d = new Date(Date.parse(d + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10)) zile.push(d)
  const v = (x) => zile.map(() => x)
  return { latitude: 44, longitude: 26, elevation: 100,
    daily_units: { precipitation_sum: 'mm', rain_sum: 'mm', snowfall_sum: 'cm', temperature_2m_min: '°C', temperature_2m_max: '°C', wind_speed_10m_max: 'km/h', wind_gusts_10m_max: 'km/h', weather_code: 'wmo code' },
    daily: { time: zile, precipitation_sum: v(1), rain_sum: v(1), snowfall_sum: v(0), temperature_2m_min: v(1), temperature_2m_max: v(5), wind_speed_10m_max: v(10), wind_gusts_10m_max: v(20), weather_code: v(3) } }
}
function retea(st, siteDupaLat, { raspuns = () => 'ok', pasMs = 0, antete = anteteImplicite, curent = () => 'ok', curentPasMs = 0, omPasMs = 0, agataRetea = () => null, omOk = false } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    const ag = agataRetea(u)
    if (ag === 'cerere') return new Promise(() => {})
    if (u.includes('open-meteo.com')) {
      st.openMeteo++; st.timpi.push(Date.now())
      if (omPasMs) vi.setSystemTime(Date.now() + omPasMs)
      if (ag === 'corp') return corpAgatat(200)
      return omOk ? json(arhivaOk(u), 200) : json({}, 503)
    }
    if (ag === 'corp') return corpAgatat(200, cota())
    if (!u.startsWith(XW)) throw new Error('rețea neașteptată: ' + u)
    const c = u.slice(XW.length)
    if (!/[?&]client_id=ID&client_secret=SEC$/.test(c)) throw new Error('credențiale lipsă în cerere')
    if (!c.startsWith('conditions/summary/') && !c.startsWith('observations/summary/')) {
      const ep = epCurent(c)
      st.curente++; st.curenteEp.push(ep)
      // cele 4 cereri ale unui site pleacă în paralel (Promise.all): ceasul avansează abia după ce au plecat toate
      if (curentPasMs && ep === 'conditions') { await null; vi.setSystemTime(Date.now() + curentPasMs) }
      const r = curent({ ep })
      if (r === 'ok') return json(curentOk, 200, antete({ ep, status: 200 }))
      return json(r.json ?? {}, r.status, r.antete ?? antete({ ep, status: r.status }))
    }
    const ep = c.startsWith('conditions') ? 'conditions' : 'observations'
    const epc = ep + '/summary'
    const lat = Number(/(?:summary\/|p=)(-?[\d.]+),/.exec(c)[1])
    const from = Number(/from=(\d+)/.exec(c)[1])
    const zi = new Date((from + 3 * 3600) * 1000).toISOString().slice(0, 10)
    const site = siteDupaLat.get(lat)
    st.zilnic.push({ ep, site, zi })
    st.timpi.push(Date.now())
    if (pasMs) vi.setSystemTime(Date.now() + pasMs)
    const r = raspuns({ ep, site, zi })
    if (r === 'retea') throw new TypeError('fetch failed')
    if (r === 'ok') return json(ep === 'conditions' ? condOk(zi) : obsOk(zi), 200, antete({ ep: epc, status: 200 }))
    return json(r.json ?? {}, r.status, r.antete ?? antete({ ep: epc, status: r.status }))
  }
}
const santier = (id, o = {}) => ({ id, name: 'S' + id, lat: 44 + id / 10, lng: 26, proiect_id: null, active: true, meteo_activ: true,
  tip_locatie: 'santier', raport_zilnic_necesar: false, localitate_meteo: null, ...o })
const sediu = (id) => santier(id, { tip_locatie: 'sediu' })
const vremeZi = (site_id, data) => ({ site_id, data, versiune: 1, tmax_c: 9, observatii_stare: 'ok', statie_id: 'LRBS' })
const zileInapoi = (de, k) => Array.from({ length: k }, (_, i) => new Date(Date.parse(de + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10))

let fetchVechi
beforeEach(() => {
  fetchVechi = globalThis.fetch
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T04:05:00Z'))   // rularea cron de la 04:05 UTC; azi = 13.11, ieri = 12.11 (ora României)
})
afterEach(() => { vi.useRealTimers(); globalThis.fetch = fetchVechi; delete globalThis.Deno; delete globalThis.__xwSupabase })

async function ruleaza(st, { index, logica, cota: cotaTs, env, cerere, ...net } = {}) {
  globalThis.__xwSupabase = { createClient: clientSimulat(st) }
  retea(st, new Map(st.tabele.sites.map(s => [s.lat, s.id])), net)
  const h = await incarcaHandler({ index, logica, cota: cotaTs, env })
  const req = cerere || new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { 'x-meteo-secret': SECRET }, body: '{}' })
  const res = await h(req)
  return { status: res.status, body: await res.json() }
}
const cereriCond = (st) => st.zilnic.filter(x => x.ep === 'conditions').map(x => `${x.site}:${x.zi}`)
// r6: rularea cu CEAS SIMULAT complet (Date + setTimeout): un apel agățat nu se termină niciodată, ceasul avansează în pași de 250 ms până
// la 130 s; întoarce dacă a plecat răspunsul și după cât timp (cronul așteaptă 120 s)
async function ruleazaCuCeas(st, { index, logica, cota: cotaTs, env, cerere, ...net } = {}) {
  globalThis.__xwSupabase = { createClient: clientSimulat(st) }
  retea(st, new Map(st.tabele.sites.map(s => [s.lat, s.id])), net)
  const h = await incarcaHandler({ index, logica, cota: cotaTs, env })
  const acum = Date.now()
  // (useFakeTimers peste ceasul deja simulat din beforeEach nu reinstalează nimic: întâi ceasul real, apoi ceasul complet)
  vi.useRealTimers()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(acum)
  const req = cerere || new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { 'x-meteo-secret': SECRET }, body: '{}' })
  let gata = null
  h(req).then(async (r) => { const ms = Date.now() - acum; gata = { status: r.status, body: await r.json(), ms } }, (e) => { gata = { exceptie: e } })
  for (let i = 0; i < 520 && !gata; i++) await vi.advanceTimersByTimeAsync(250)
  return gata ? { raspuns: true, ...gata } : { raspuns: false, ms: Date.now() - acum }
}

// scenariul țintelor: 1 = raport acum 13 zile (activ); 2 = raport acum 15 zile (inactiv, ziua lui fără vreme); 3 = raport cu vreme;
// 4 = fără rapoarte; 5 = sediul (vremea curentă, fără rapoarte)
const stareTinte = () => stare({
  sites: [santier(1), santier(2), santier(3), santier(4), sediu(5)],
  rapoarte: [{ site_id: 1, data: '2026-10-31' }, { site_id: 2, data: '2026-10-29' }, { site_id: 3, data: '2026-10-20' }],
  vreme: [vremeZi(3, '2026-10-20')],
})
const TINTE_ASTEPTATE = [...zileInapoi('2026-11-12', 7).map(z => `1:${z}`), '1:2026-10-31', '2:2026-10-29']

// scenariul plafonului (r5: în fereastra de 31 de zile): șantierele 1 și 2, inactive, cu câte 17 zile cu raport fără vreme (29.10 → 13.10)
// = 34 de sarcini > 30 (cât încape în 60 de unități) → coada se rotește: pornire = ⌊fracția(20769 × φ) × 34⌋ = ⌊0,94791… × 34⌋ = 32
// (20769 = indexul zilei 12.11.2026 de la 01.01.1970: 56 × 365 + 14 zile bisecte + 315; φ = 0,6180339887…; calculat separat de cod)
const ZILE_PLAFON = zileInapoi('2026-10-29', 17)
const starePlafon = () => stare({ sites: [santier(1), santier(2), sediu(9)],
  rapoarte: ZILE_PLAFON.flatMap(data => [{ site_id: 1, data }, { site_id: 2, data }]) })
// ordinea „cele mai noi întâi, apoi după șantier”: L[i] = (29.10 − ⌊i/2⌋, șantierul 1 + i mod 2); rotită de la 32 → servite L[32], L[33],
// L[0..27]; neajunse L[28..31]
const L_PLAFON = ZILE_PLAFON.flatMap(z => [`1:${z}`, `2:${z}`])

describe('cron 04:05 UTC: țintele r4 (neschimbate) și vremea curentă', () => {
  it('cere doar (a) șantierul activ (ieri + reluarea) și (b) zilele cu raport fără vreme, cele mai noi întâi; vremea curentă neschimbată', async () => {
    const st = stareTinte()
    const { status, body } = await ruleaza(st)
    expect(status).toBe(200)
    expect(cereriCond(st)).toEqual(TINTE_ASTEPTATE)
    expect(body.xweather).toMatchObject({ ok: true, complet: true, scrise: 9, accese_xweather: 18, unitati_xweather: 18, plafon_unitati: 60,
      buget_ms: 40_000, sarcini_pe_tinta: { activ: 7, raport: 2 }, santiere_active: [1], oprit: null, rotatie: { pornire: 0, pas: 30 } })
    expect(body.accese_xweather).toBe(18)
    expect(st.scrise.meteo_zilnic_xweather).toHaveLength(9)
    // vremea curentă: sediul, cu prognoza / alertele / aerul la ora 04 UTC (4 cereri), ca înainte; r5: înaintea pasului zilnic
    expect(st.curente).toBe(4)
    expect(body.n).toBe(1)
  })
  it('reverificarea automată nu mai are loc: alaltăieri existent nu se mai cere; doar ieri, care lipsește', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-11' }],
      vreme: zileInapoi('2026-11-11', 6).map(z => vremeZi(1, z)) })
    const { body } = await ruleaza(st)
    expect(st.zilnic.map(x => `${x.ep}:${x.zi}`)).toEqual(['conditions:2026-11-12', 'observations:2026-11-12'])
    expect(body.xweather).toMatchObject({ ok: true, scrise: 1, versiuni_noi: 0, neschimbate: 0, accese_xweather: 2 })
  })
})

describe('r5 — costul din antete și blocul `cota` (pentru TOATE cererile Xweather)', () => {
  it('rularea de la 04:05: vremea curentă 1+1+1+5 = 8 unități + pasul zilnic 18 = 26; restul / limita / resetarea din antete', async () => {
    const st = stareTinte()
    const { body } = await ruleaza(st)
    expect(body.cota).toMatchObject({ cereri: 22, unitati: 26, unitati_estimate: 0, estimate: 0, total_prudent: 26, cota_necunoscuta: false,
      perioada: { limita: 100000, rest: 90000, resetare: '2026-11-30T00:00:00.000Z', tip: 'month' }, minut: { limita: 1000, rest: 990 },
      aer_pe_zi: 4, pas_zilnic_activ: true, oprit: null })
    expect(body.cota.pe_endpoint).toEqual({
      conditions: { cereri: 1, unitati: 1, estimate: 0, cost_max: 1 }, forecasts: { cereri: 1, unitati: 1, estimate: 0, cost_max: 1 },
      alerts: { cereri: 1, unitati: 1, estimate: 0, cost_max: 1 }, airquality: { cereri: 1, unitati: 5, estimate: 0, cost_max: 5 },
      'conditions/summary': { cereri: 9, unitati: 9, estimate: 0, cost_max: 1 }, 'observations/summary': { cereri: 9, unitati: 9, estimate: 0, cost_max: 1 },
    })
    // fără chei: nici client_id, nici client_secret, nici URL-uri în răspuns
    expect(JSON.stringify(body)).not.toMatch(/client_(id|secret)|SEC\b|https?:\/\//)
  })
  it('fără X-Cost-Tokens: multiplicatorul documentat, marcat „estimat” (aerul = 5); cu X-Cost-Multiplier (singular) = produsul, nu estimat', async () => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { antete: ({ ep }) => (ep === 'forecasts' ? { 'X-Cost-Multiplier': 'endpoint=2; temporal=1; spatial=3', ...cota() } : cota()) })
    // conditions 1 + alerts 1 + airquality 5 estimate (3 cereri); forecasts = 2 × 1 × 3 = 6 din antet
    expect(body.cota).toMatchObject({ unitati: 6, unitati_estimate: 7, estimate: 3, total_prudent: 13 })
    expect(body.cota.pe_endpoint.airquality).toEqual({ cereri: 1, unitati: 5, estimate: 1, cost_max: 0 })
    expect(body.cota.multiplicatori).toEqual({ forecasts: 'endpoint=2; temporal=1; spatial=3' })
  })
  it('antetul de multiplicatori la plural (X-Cost-Multipliers) e acceptat la fel', async () => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { antete: ({ ep }) => (ep === 'airquality' ? { 'X-Cost-Multipliers': 'endpoint=5;temporal=1;spatial=1', ...cota() } : cota()) })
    expect(body.cota.pe_endpoint.airquality).toEqual({ cereri: 1, unitati: 5, estimate: 0, cost_max: 5 })
    expect(body.cota.estimate).toBe(3)
  })
})

describe('r5 — întrerupătorul XW_ZILNIC_ACTIV', () => {
  it('fără variabilă: la 04:05 nicio cerere conditions/summary / observations/summary, tabelul nou necitit; vremea curentă merge; HTTP 200', async () => {
    const st = stareTinte()
    const { status, body } = await ruleaza(st, { env: { XW_ZILNIC_ACTIV: undefined } })
    expect(st.zilnic).toHaveLength(0)
    expect(st.citite).not.toContain('v_meteo_zilnic_xweather')
    expect(st.citite).not.toContain('rapoarte_zilnice')
    expect(body.xweather).toEqual({ activ: false, motiv: 'pas zilnic oprit (configurare)' })
    expect(body.xweather_ok).toBeNull()
    expect(status).toBe(200)
    expect(st.curente).toBe(4)
    expect(body.cota).toMatchObject({ pas_zilnic_activ: false, unitati: 8 })
  })
  it('orice altă valoare decât exact „1” (true, 01, 1 cu spațiu) = oprit', async () => {
    for (const v of ['true', '01', ' 1', '']) {
      const st = stareTinte()
      await ruleaza(st, { env: { XW_ZILNIC_ACTIV: v } })
      expect(st.zilnic).toHaveLength(0)
    }
  })
  it('comanda owner-ului cu întrerupătorul oprit: 409, nicio cerere, nicio citire a tabelului nou', async () => {
    const st = stare({ sites: [santier(1)], profiles: [{ id: 'u-owner', is_owner: true }], useri: { 'tok-owner': 'u-owner' } })
    const cerere = new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { Authorization: 'Bearer tok-owner' },
      body: JSON.stringify({ xweather_backfill: true, site_id: 1, de_la: '2026-10-01', pana: '2026-10-31' }) })
    const { status, body } = await ruleaza(st, { env: { XW_ZILNIC_ACTIV: undefined }, cerere })
    expect(status).toBe(409)
    expect(body.error).toBe('pas zilnic oprit (configurare)')
    expect(st.zilnic).toHaveLength(0)
    expect(st.citite).not.toContain('v_meteo_zilnic_xweather')
  })
})

describe('plafonul de unități, numărătoarea, rotația', () => {
  it('se oprește exact la 60: 30 de zile din coada rotită (pornire 32), 4 „neajunsă (plafonul de unități)”, HTTP 207, complet:false', async () => {
    const st = starePlafon()
    const { status, body } = await ruleaza(st)
    expect(st.zilnic).toHaveLength(60)
    expect(cereriCond(st)).toEqual([...L_PLAFON.slice(32), ...L_PLAFON.slice(0, 28)])
    expect(status).toBe(207)
    expect(body.xweather).toMatchObject({ ok: false, complet: false, scrise: 30, neajunse: 4, nr_nesalvate: 4, accese_xweather: 60, unitati_xweather: 60,
      rotatie: { pornire: 32, pas: 30 } })
    expect(body.xweather.zile_nesalvate.map(x => `${x.site_id}:${x.zi}`)).toEqual(L_PLAFON.slice(28, 32))
    expect(body.xweather.zile_nesalvate.map(x => x.motiv)).toEqual(Array(4).fill('neajunsă (plafonul de unități)'))
    expect(body.xweather_ok).toBe(false)
  })
  it('zilele fără date costă o unitate: plafonul tot nu e depășit (59 de zile, 59 de unități) și sunt listate (zile_fara_date)', async () => {
    const st = stare({ sites: [santier(1), santier(2), santier(3), santier(4), sediu(9)],
      rapoarte: ZILE_PLAFON.flatMap(data => [1, 2, 3, 4].map(site_id => ({ site_id, data }))) })
    const { body } = await ruleaza(st, { raspuns: ({ ep }) => (ep === 'conditions' ? { status: 200, json: { success: true, error: { code: 'warn_no_data' }, response: [] } } : 'ok') })
    expect(body.xweather.unitati_xweather).toBe(59)
    expect(st.zilnic).toHaveLength(59)
    expect(body.xweather.lipsa).toBe(59)
    expect(body.xweather.zile_fara_date).toHaveLength(59)
  })
  it('numărătoarea include cererile eșuate (503, rețea, observații 502), socotite prudent cu multiplicatorul documentat', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-29', 5).map(data => ({ site_id: 1, data })) })
    const rasp = ({ ep, zi }) => {
      if (zi === '2026-10-29') return { status: 503, json: null }
      if (zi === '2026-10-28') return 'retea'
      if (zi === '2026-10-27' && ep === 'observations') return { status: 502, json: null }
      return 'ok'
    }
    const { status, body } = await ruleaza(st, { raspuns: rasp })
    expect(body.xweather.accese_xweather).toBe(1 + 1 + 2 + 2 + 2)
    expect(body.xweather.unitati_xweather).toBe(8)
    expect(body.xweather).toMatchObject({ scrise: 2, tranzitorii: 3, nr_nesalvate: 3 })
    // 503, rețea, 502: 3 cereri fără antet de cost → estimate
    expect(body.cota.pe_endpoint['conditions/summary']).toMatchObject({ cereri: 5, estimate: 2 })
    expect(body.cota.pe_endpoint['observations/summary']).toMatchObject({ cereri: 3, estimate: 1 })
    expect(status).toBe(207)
  })
  it('un antet care arată un cost mai mare la observații (3) mărește rezerva unei zile (1 + 3) pentru zilele următoare', async () => {
    const st = starePlafon()
    const antete = ({ ep, status }) => ({ ...anteteImplicite({ ep, status }), ...(ep === 'observations/summary' ? { 'X-Cost-Tokens': '3' } : {}) })
    const { body } = await ruleaza(st, { antete })
    // prima zi: rezervă 2, costă 4; apoi rezervă 4: 4 × 15 = 60 → 15 zile
    expect(cereriCond(st)).toHaveLength(15)
    expect(body.xweather).toMatchObject({ unitati_xweather: 60, cost_zi_santier: 4, scrise: 15 })
  })
})

describe('r5 — garda de cotă (vremea curentă are prioritate până la resetare)', () => {
  // sediul 9 = singura țintă a vremii curente: pe zi 12 × 1 + 4 × (1 + 1) + 4 × 5 = 40 de unități; până la 30.11: 17 zile → 680 + marja 300 = 980
  it('rest suficient (90.000): pasul rulează cu plafonul întreg; cifrele gărzii în rezultat', async () => {
    const st = starePlafon()
    const { body } = await ruleaza(st)
    expect(body.xweather.garda_cota).toEqual({ cunoscuta: true, rest: 90000, resetare: '2026-11-30T00:00:00.000Z', zile: 17,
      cost_zi_vreme_curenta: 40, rezerva: 980, marja: 300, disponibil: 89020, plafon: 60 })
  })
  it('rest 992 → disponibil 992 − 980 = 12 → plafon 12 = 6 zile; rest 981 → disponibil 1 < 2 → nicio zi, nicio cerere, 207', async () => {
    let st = starePlafon()
    let r = await ruleaza(st, { antete: ({ ep, status }) => ({ ...anteteImplicite({ ep, status }), ...cota(992) }) })
    expect(r.body.xweather.garda_cota).toMatchObject({ disponibil: 12, plafon: 12 })
    expect(cereriCond(st)).toHaveLength(6)
    st = starePlafon()
    r = await ruleaza(st, { antete: ({ ep, status }) => ({ ...anteteImplicite({ ep, status }), ...cota(981) }) })
    expect(st.zilnic).toHaveLength(0)
    expect(r.status).toBe(207)
    expect(r.body.xweather.garda_cota).toMatchObject({ disponibil: 1, plafon: 1 })
    expect(r.body.xweather.zile_nesalvate[0].motiv).toBe('neajunsă (rezerva de cotă pentru vremea curentă)')
    expect(r.body.xweather.neajunse).toBe(34)
  })
  it('restul scade pe parcurs (antetele pasului): se oprește când nu mai acoperă rezerva', async () => {
    const st = starePlafon()
    let rest = 1000
    const antete = ({ ep, status }) => ({ ...anteteImplicite({ ep, status }), ...cota(ep.includes('summary') ? (rest -= 2) : rest) })
    const { body } = await ruleaza(st, { antete })
    // după vremea curentă rest = 1000 → disponibil 20 → plafon 20 (10 zile); dar fiecare cerere a pasului scade restul cu 2 (alt consumator
    // pe cont) → înaintea zilei n restul e 1000 − 4(n − 1); garda cere rest − 980 ≥ 2 → n ≤ 5; a 6-a zi (rest 980) nu mai începe
    expect(cereriCond(st)).toHaveLength(5)
    expect(body.xweather.zile_nesalvate[0].motiv).toBe('neajunsă (rezerva de cotă pentru vremea curentă)')
  })
  it('fără antete de cotă: plafonul mic declarat (10 unități = 5 zile), „cota_necunoscuta”', async () => {
    const st = starePlafon()
    const { body } = await ruleaza(st, { antete: ({ ep, status }) => (status >= 200 && status < 300 ? { 'X-Cost-Tokens': String(COST_DOC[ep]) } : {}) })
    expect(cereriCond(st)).toHaveLength(5)
    expect(body.xweather.garda_cota).toMatchObject({ cunoscuta: false, plafon: 10 })
    expect(body.cota.cota_necunoscuta).toBe(true)
  })
})

describe('r5 — 429 / maxhits pe coduri', () => {
  const pe5 = () => stare({ sites: [santier(1), sediu(9)], rapoarte: zileInapoi('2026-10-29', 5).map(data => ({ site_id: 1, data })) })
  it('429 maxhits (perioada) la conditions/summary: o cerere, restul „neajunsă (oprit: …)”', async () => {
    const st = pe5()
    const { body } = await ruleaza(st, { raspuns: () => ({ status: 429, json: { success: false, error: { code: 'maxhits' } } }) })
    expect(st.zilnic).toHaveLength(1)
    expect(body.xweather.oprit).toMatch(/maxhits/)
    expect(body.xweather.zile_nesalvate[0].motiv).toMatch(/^oprită: cota perioadei \(maxhits\)/)
    expect(body.xweather.zile_nesalvate.slice(1).every(x => /^neajunsă \(oprit: cota perioadei/.test(x.motiv))).toBe(true)
    expect(body.cota.oprit).toMatch(/maxhits/)
  })
  it('429 fără cod: tratat prudent ca limita perioadei (oprire)', async () => {
    const st = pe5()
    const { body } = await ruleaza(st, { raspuns: () => ({ status: 429, json: { success: false } }) })
    expect(st.zilnic).toHaveLength(1)
    expect(body.xweather.oprit).toMatch(/429/)
  })
  it('maxhits_daily la vremea curentă: oprește TOT ce e Xweather în rulare (restul vremii curente și pasul zilnic, zero cereri)', async () => {
    const st = stare({ sites: [sediu(8), sediu(9), santier(1)], rapoarte: [{ site_id: 1, data: '2026-10-29' }] })
    const { body, status } = await ruleaza(st, { curent: ({ ep }) => (ep === 'conditions' ? { status: 429, json: { success: false, error: { code: 'maxhits_daily' } } } : 'ok') })
    expect(st.curenteEp.filter(e => e === 'conditions')).toHaveLength(1)
    expect(st.zilnic).toHaveLength(0)
    expect(body.rez.find(r => r.site === 9)).toMatchObject({ ok: false, eroare: expect.stringMatching(/^oprit: cota zilei \(maxhits_daily/) })
    expect(body.xweather.oprit).toMatch(/maxhits_daily/)
    expect(status).toBe(207)
  })
  it('maxhits_min: așteaptă resetarea minutului O dată (în termen), apoi continuă: toate zilele salvate', async () => {
    const st = pe5()
    let prima = true
    const raspuns = ({ ep }) => {
      if (prima && ep === 'conditions') {
        prima = false
        return { status: 429, json: { success: false, error: { code: 'maxhits_min' } }, antete: { ...cota(), 'X-RateLimit-Reset-Minute': new Date(Date.now() + 300).toISOString() } }
      }
      return 'ok'
    }
    const { body, status } = await ruleaza(st, { raspuns })
    expect(status).toBe(200)
    expect(body.xweather).toMatchObject({ ok: true, complet: true, scrise: 5, oprit: null })
    expect(body.cota.asteptari_minut).toBe(1)
    expect(st.zilnic).toHaveLength(11)   // 10 + cererea repetată
  })
  it('maxhits_min a doua oară: oprire (o singură așteptare pe rulare)', async () => {
    const st = pe5()
    const raspuns = ({ ep }) => (ep === 'conditions'
      ? { status: 429, json: { success: false, error: { code: 'maxhits_min' } }, antete: { ...cota(), 'X-RateLimit-Reset-Minute': new Date(Date.now() + 300).toISOString() } }
      : 'ok')
    const { body } = await ruleaza(st, { raspuns })
    expect(st.zilnic).toHaveLength(2)
    expect(body.xweather.oprit).toMatch(/maxhits_min/)
    expect(body.cota.asteptari_minut).toBe(1)
  })
  it('maxhits_min cu resetarea după termenul pasului: nu așteaptă, se oprește', async () => {
    const st = pe5()
    const raspuns = () => ({ status: 429, json: { success: false, error: { code: 'maxhits_min' } }, antete: { ...cota(), 'X-RateLimit-Reset-Minute': new Date(Date.now() + 50_000).toISOString() } })
    const { body } = await ruleaza(st, { raspuns })
    expect(st.zilnic).toHaveLength(1)
    expect(body.cota.asteptari_minut).toBe(0)
    expect(body.xweather.oprit).toMatch(/maxhits_min/)
  })
  it('cazul recenzentului: HTTP 200 cu maxhits în corp la observațiile ULTIMEI sarcini → ziua nescrisă, complet:false, 207', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-29', 3).map(data => ({ site_id: 1, data })) })
    const raspuns = ({ ep, zi }) => (zi === '2026-10-27' && ep === 'observations' ? { status: 200, json: { success: false, error: { code: 'maxhits', description: 'x' } } } : 'ok')
    const { status, body } = await ruleaza(st, { raspuns })
    expect(st.scrise.meteo_zilnic_xweather).toHaveLength(2)
    expect(body.xweather).toMatchObject({ ok: false, complet: false, scrise: 2, oprite: 1, nr_nesalvate: 1 })
    expect(body.xweather.zile_nesalvate[0]).toMatchObject({ zi: '2026-10-27', motiv: expect.stringMatching(/^oprită: cota perioadei/) })
    expect(status).toBe(207)
  })
})

describe('r5 — termenul global (100 s de la intrarea în handler)', () => {
  it('Open-Meteo lent (24,9 s pe cerere, 5 șantiere): cel mult 30 s, restul „neajuns (termen)”; pasul zilnic Xweather tot rulează', async () => {
    const st = stare({ sites: [1, 2, 3, 4, 5].map(i => santier(i)).concat([sediu(9)]), rapoarte: [{ site_id: 1, data: '2026-10-29' }] })
    const t0 = Date.now()
    const { body } = await ruleaza(st, { omPasMs: 24_900 })
    // 6 site-uri cu coordonate (5 șantiere + sediul): cereri la 0 s și 24,9 s (5,1 s rămase ≥ 5 s); după 49,8 s nimic → 4 neajunse
    expect(st.openMeteo).toBe(2)
    expect(body.istoric.neajunse).toBe(4)
    expect(body.istoric.rez.filter(r => r.eroare === 'neajuns (termen)')).toHaveLength(4)
    expect(Math.max(...st.timpi.filter((_, i) => i < 2)) - t0).toBeLessThan(30_000)
    expect(body.xweather).toMatchObject({ ok: true, scrise: 1 })
    expect(body.termen.durata_ms).toBeLessThan(100_000)
  })
  it('vremea curentă lentă (9 s pe site): 11 site-uri (ultimul pornește la 90 s, cu 10 s rămase), 4 „neajuns (termen)”, istoricul și pasul zilnic la fel', async () => {
    const sites = Array.from({ length: 15 }, (_, i) => sediu(i + 1)).concat([santier(20)])
    const st = stare({ sites, rapoarte: [{ site_id: 20, data: '2026-10-29' }] })
    const { body, status } = await ruleaza(st, { curentPasMs: 9_000 })
    expect(body.rez.filter(r => r.ok)).toHaveLength(11)
    expect(body.rez.filter(r => r.eroare === 'neajuns (termen)')).toHaveLength(4)
    expect(body.istoric).toEqual({ ok: false, complet: false, eroare: 'neajuns (termen)' })
    expect(body.xweather).toMatchObject({ ok: false, neajuns: 'neajuns (termen)', accese_xweather: 0 })
    expect(st.zilnic).toHaveLength(0)
    expect(st.openMeteo).toBe(0)
    expect(body.termen.durata_ms).toBeLessThanOrEqual(100_000)
    expect(status).toBe(207)
  })
})

describe('r4 — termenul pasului zilnic (40 s, sub termenul global)', () => {
  it('cu 3 s pe cerere: 6 zile, restul „neajunsă (bugetul de timp)”; nicio cerere după termen', async () => {
    const st = stare({ sites: [santier(1), santier(2), sediu(9)], rapoarte: zileInapoi('2026-10-29', 10).flatMap(data => [{ site_id: 1, data }, { site_id: 2, data }]) })
    const { status, body } = await ruleaza(st, { pasMs: 3000 })
    expect(cereriCond(st)).toHaveLength(6)
    expect(body.xweather).toMatchObject({ accese_xweather: 12, neajunse: 14, scrise: 6 })
    expect(body.xweather.zile_nesalvate.map(x => x.motiv)).toEqual(Array(14).fill('neajunsă (bugetul de timp)'))
    expect(Math.max(...st.timpi) - Math.min(...st.timpi)).toBeLessThan(40_000)
    expect(body.xweather.durata_ms).toBeLessThanOrEqual(40_000)
    expect(status).toBe(207)
  })
})

describe('r5 — fereastra de 31 de zile și „nimic de făcut”', () => {
  it('raport acum 31 de zile (13.10) intră; acum 32 (12.10) nu (doar comanda owner-ului)', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-10-13' }, { site_id: 1, data: '2026-10-12' }] })
    await ruleaza(st)
    expect(cereriCond(st)).toEqual(['1:2026-10-13'])
  })
  it('toate țintele ferestrei au vreme: zero cereri ale pasului, nimic_de_facut, HTTP 200', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-10' }],
      vreme: zileInapoi('2026-11-12', 7).map(z => vremeZi(1, z)) })
    const { status, body } = await ruleaza(st)
    expect(st.zilnic).toHaveLength(0)
    expect(body.xweather).toMatchObject({ ok: true, complet: true, nimic_de_facut: true, accese_xweather: 0, unitati_xweather: 0 })
    expect(status).toBe(200)
  })
  it('a doua rulare din aceeași zi, după ce prima a salvat tot: zero cereri ale pasului', async () => {
    const st = stareTinte()
    await ruleaza(st)
    expect(st.zilnic).toHaveLength(18)
    st.tabele.v_meteo_zilnic_xweather.push(...st.scrise.meteo_zilnic_xweather.map(r => ({ ...r })))
    st.zilnic = []
    const { body } = await ruleaza(st)
    expect(st.zilnic).toHaveLength(0)
    expect(body.xweather.nimic_de_facut).toBe(true)
  })
})

describe('r5 — XW_AER_PE_ZI (câte rulări complete cer aerul, cost 5)', () => {
  const aerLa = async (ora, v) => {
    vi.setSystemTime(new Date(`2026-11-13T${String(ora).padStart(2, '0')}:05:00Z`))
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { env: { XW_AER_PE_ZI: v } })
    return { aer: st.curenteEp.filter(e => e === 'airquality').length, body, ep: st.curenteEp }
  }
  it('4 (implicit, ca până acum): aerul la 04 / 10 / 16 / 22', async () => {
    for (const ora of [4, 10, 16, 22]) expect((await aerLa(ora, undefined)).aer).toBe(1)
    expect((await aerLa(6, undefined)).ep).toEqual(['conditions'])
  })
  it('1: doar la 04:05 UTC; 0: niciodată (prognoza și alertele rămân)', async () => {
    expect((await aerLa(4, '1')).aer).toBe(1)
    expect((await aerLa(10, '1')).aer).toBe(0)
    expect((await aerLa(22, '1')).aer).toBe(0)
    const z = await aerLa(4, '0')
    expect(z.aer).toBe(0)
    expect([...z.ep].sort()).toEqual(['alerts', 'conditions', 'forecasts'])
    expect(z.body.cota.aer_pe_zi).toBe(0)
  })
  it('valoare invalidă: 4 (ca până acum) și semnalată în `cota`', async () => {
    const z = await aerLa(22, 'doi')
    expect(z.aer).toBe(1)
    expect(z.body.cota).toMatchObject({ aer_pe_zi: 4, aer_pe_zi_invalid: 'doi' })
  })
})

describe('comanda owner-ului (xweather_backfill): drepturi neschimbate, plafonul ei, aceeași numărătoare', () => {
  const stareOwner = () => stare({ sites: [santier(1)], profiles: [{ id: 'u-owner', is_owner: true }, { id: 'u-x', is_owner: false }],
    useri: { 'tok-owner': 'u-owner', 'tok-x': 'u-x' } })
  const cu = (tok, body) => new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })
  it('non-owner → 403, nicio cerere către furnizor', async () => {
    const st = stareOwner()
    const { status, body } = await ruleaza(st, { cerere: cu('tok-x', { xweather_backfill: true, site_id: 1, de_la: '2026-10-01', pana: '2026-10-31' }) })
    expect(status).toBe(403)
    expect(body.error).toMatch(/doar owner-ul/)
    expect(st.zilnic).toHaveLength(0)
  })
  it('owner, max_zile 40: 31 de zile (62 de unități = plafonul apelului), 9 neajunse, reluarea de la prima neajunsă; blocul cota', async () => {
    vi.setSystemTime(new Date('2026-11-13T09:30:00Z'))
    const st = stareOwner()
    const { status, body } = await ruleaza(st, { cerere: cu('tok-owner', { xweather_backfill: true, site_id: 1, de_la: '2026-09-01', pana: '2026-10-31', max_zile: 40 }) })
    expect(status).toBe(207)
    expect(body.xweather).toMatchObject({ accese_xweather: 62, unitati_xweather: 62, plafon_unitati: 62, scrise: 31, neajunse: 9, continua_pana: '2026-09-30', buget_ms: 100_000 })
    expect(st.zilnic).toHaveLength(62)
    expect(body.cota).toMatchObject({ unitati: 62, cereri: 62 })
  })
  it('owner: zilele fără date sunt sărite de cursor și listate', async () => {
    vi.setSystemTime(new Date('2026-11-13T09:30:00Z'))
    const st = stareOwner()
    const raspuns = ({ zi, ep }) => (ep === 'conditions' && zi < '2026-09-05' ? { status: 200, json: { success: true, error: { code: 'warn_no_data' }, response: [] } } : 'ok')
    const { body } = await ruleaza(st, { raspuns, cerere: cu('tok-owner', { xweather_backfill: true, site_id: 1, de_la: '2026-09-01', pana: '2026-09-10' }) })
    expect(body.xweather.zile_fara_date.map(x => x.zi)).toEqual(['2026-09-04', '2026-09-03', '2026-09-02', '2026-09-01'])
    expect(body.xweather).toMatchObject({ ok: true, complet: true, scrise: 6, lipsa: 4, continua_pana: null })
  })
})

describe('mutanții pică (L25)', () => {
  it('originalul trece scenariul țintelor (control)', async () => {
    const st = stareTinte()
    await ruleaza(st)
    expect(cereriCond(st)).toEqual(TINTE_ASTEPTATE)
  })
  it('M1 țintele vechi (toate șantierele cu vreme activă): cere și șantierele fără activitate', async () => {
    const st = stareTinte()
    await ruleaza(st, { logica: mutant(LOGICA, [['  if (!zile || !zile.size) return false\n', '  return true\n']]) })
    expect(cereriCond(st)).not.toEqual(TINTE_ASTEPTATE)
  })
  it('M2 plafon ignorat: trece de 60 de unități', async () => {
    const st = starePlafon()
    const { body } = await ruleaza(st, { index: mutant(INDEX, [['poateIncepeZi(unitati(), plafon, Date.now(), termen, costZi)', 'poateIncepeZi(0, plafon, Date.now(), termen, costZi)']]) })
    expect(st.zilnic.length).toBeGreaterThan(60)
    expect(body.xweather.unitati_xweather).toBeGreaterThan(60)
  })
  it('M3 numărătoarea sare cererile eșuate: accese / unități mai mici decât cererile trimise', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-29', 3).map(data => ({ site_id: 1, data })) })
    const idx = mutant(INDEX, [['      inregistreaza(contor, endpoint, status, antete, Date.now());', '      if (status >= 200 && status < 300) inregistreaza(contor, endpoint, status, antete, Date.now());']])
    const { body } = await ruleaza(st, { index: idx, raspuns: ({ zi }) => (zi === '2026-10-29' ? { status: 503, json: null } : zi === '2026-10-28' ? 'retea' : 'ok') })
    expect(st.zilnic).toHaveLength(4)
    expect(body.xweather.accese_xweather).not.toBe(4)
  })
  it('M4 termenul pasului ignorat: continuă după 40 s', async () => {
    const st = stare({ sites: [santier(1), santier(2), sediu(9)], rapoarte: zileInapoi('2026-10-29', 10).flatMap(data => [{ site_id: 1, data }, { site_id: 2, data }]) })
    await ruleaza(st, { pasMs: 3000, index: mutant(INDEX, [['const termen = Math.min(t0 + buget, termenGlobal);', 'const termen = t0 + 1e9;']]) })
    expect(cereriCond(st).length).toBeGreaterThan(6)
  })
  it('M5 reverificarea lui alaltăieri readusă în planul zilnic: alaltăieri existent se cere din nou', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-11' }], vreme: zileInapoi('2026-11-11', 6).map(z => vremeZi(1, z)) })
    const lg = mutant(LOGICA, [["          if (ex.has(d) || d < PRIMA_ZI_XW", "          if ((ex.has(d) && d !== adunaZile(ieri, -1)) || d < PRIMA_ZI_XW"]])
    await ruleaza(st, { logica: lg })
    expect(st.zilnic.some(x => x.zi === '2026-11-11')).toBe(true)
  })
  it('M6 costul din antete ignorat (mereu estimat): aerul cu X-Cost-Tokens apare estimat', async () => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { cota: mutant(COTA, [["    if (tok != null) return { unitati: tok, sursa: 'antet', multiplicatori: mult }\n", '']]) })
    expect(body.cota.estimate).not.toBe(0)
  })
  it('M7 aerul socotit 1 (multiplicatorul greșit): estimarea aerului fără antet nu mai e 5', async () => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { antete: () => cota(), cota: mutant(COTA, [['alerts: 1, airquality: 5,', 'alerts: 1, airquality: 1,']]) })
    expect(body.cota.pe_endpoint.airquality.unitati).not.toBe(5)
  })
  it('M8 întrerupătorul ignorat: fără variabilă se fac cereri conditions/summary', async () => {
    const st = stareTinte()
    await ruleaza(st, { env: { XW_ZILNIC_ACTIV: undefined }, cota: mutant(COTA, [["export const zilnicActiv = (v: string | null | undefined) => v === '1'", 'export const zilnicActiv = (v: string | null | undefined) => true']]) })
    expect(st.zilnic.length).toBeGreaterThan(0)
  })
  it('M9 garda de cotă ignorată: cu rest insuficient se fac totuși cereri', async () => {
    const st = starePlafon()
    const cotaM = mutant(COTA, [['  if (!g.cunoscuta) return null      // cota necunoscută: decide plafonul mic, nu garda\n', '  return null\n'],
      ['plafon: Math.max(0, Math.min(plafon, disponibil)) }', 'plafon }']])
    await ruleaza(st, { cota: cotaM, antete: ({ ep, status }) => ({ ...anteteImplicite({ ep, status }), ...cota(981) }) })
    expect(st.zilnic.length).toBeGreaterThan(0)
  })
  it('M10 maxhits_min fără așteptare: prima limită pe minut oprește tot (zilele rămân nesalvate)', async () => {
    const st = stare({ sites: [santier(1), sediu(9)], rapoarte: zileInapoi('2026-10-29', 5).map(data => ({ site_id: 1, data })) })
    let prima = true
    const raspuns = ({ ep }) => {
      if (prima && ep === 'conditions') { prima = false; return { status: 429, json: { success: false, error: { code: 'maxhits_min' } }, antete: { ...cota(), 'X-RateLimit-Reset-Minute': new Date(Date.now() + 300).toISOString() } } }
      return 'ok'
    }
    const { body } = await ruleaza(st, { raspuns, index: mutant(INDEX, [["if (d === 'minut' && contor.asteptari_minut === 0)", 'if (false)']]) })
    expect(body.xweather.complet).toBe(false)
  })
  it('M11 200 + maxhits la observații salvează ziua: complet devine true', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-29', 3).map(data => ({ site_id: 1, data })) })
    const raspuns = ({ ep, zi }) => (zi === '2026-10-27' && ep === 'observations' ? { status: 200, json: { success: false, error: { code: 'maxhits' } } } : 'ok')
    const idx = mutant(INDEX, [['      // r5: oprirea la observații (ex. 200 + maxhits în corp la ULTIMA sarcină) nu mai salvează ziua și nu mai raportează „complet”\n      if (contor.oprit) { oprita(s); continue; }\n', '']])
    const { body } = await ruleaza(st, { raspuns, index: idx })
    expect(body.xweather.scrise).toBe(3)
  })
  it('M12 termenul global ignorat: vremea curentă lentă trece de 100 s', async () => {
    const sites = Array.from({ length: 15 }, (_, i) => sediu(i + 1))
    const st = stare({ sites })
    const { body } = await ruleaza(st, { curentPasMs: 9_000, index: mutant(INDEX, [['const termen = t0 + TERMEN_HANDLER_MS;', 'const termen = t0 + 1e9;']]) })
    expect(body.termen.durata_ms).toBeGreaterThan(100_000)
  })
  it('M13 fereastra scoasă: o zi cu raport de acum 32 de zile se cere automat', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-10-12' }] })
    // fereastra e impusă de aceeași funcție la citirea din BD și în plan: mutantul o strică în ambele locuri
    await ruleaza(st, { logica: mutant(LOGICA, [['  const de = adunaZile(ieri, -(Math.max(FEREASTRA_RAPOARTE_ZILE, ZILE_RELUARE_ACTIVE, ZILE_ACTIVITATE) - 1))\n',
      '  const de = PRIMA_ZI_XW\n']]) })
    expect(cereriCond(st)).toEqual(['1:2026-10-12'])
  })
  it('M14 XW_AER_PE_ZI ignorat: cu 0 se cere totuși aerul', async () => {
    const st = stare({ sites: [sediu(5)] })
    await ruleaza(st, { env: { XW_AER_PE_ZI: '0' }, index: mutant(INDEX, [['const cuAer = complet && cereAer(aer, ora, !laOra);', 'const cuAer = complet;']]) })
    expect(st.curenteEp).toContain('airquality')
  })
  it('M15 zilele existente readuse în planul zilnic: rularea „fără nimic de făcut” ar consuma din nou', async () => {
    // garanția „zero cereri” la a doua rulare vine din plan (zilele cu vreme nu intră); mutantul care le readuce trebuie să se vadă
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-10' }], vreme: zileInapoi('2026-11-12', 7).map(z => vremeZi(1, z)) })
    await ruleaza(st, { logica: mutant(LOGICA, [["          if (ex.has(d) || d < PRIMA_ZI_XW", "          if (d < PRIMA_ZI_XW"]]) })
    expect(st.zilnic.length).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════ r6 ═══════════════════════════════════════════
const OWNER = { profiles: [{ id: 'u-owner', is_owner: true }], useri: { 'tok-owner': 'u-owner' } }
const caOwner = (body) => new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { Authorization: 'Bearer tok-owner' }, body: JSON.stringify(body) })
// scenariul complet al rulării de la 04:05: sediul 9 (vremea curentă), șantierul 1 activ cu proiect (raport 11.11) + zile vechi fără vreme
// (ieșite din fereastră: 01.10, 12.10), ca TOATE punctele de așteptare să fie atinse
const stareToate = (o = {}) => {
  const st = stare({ sites: [santier(1, { proiect_id: 7 }), sediu(9)], rapoarte: [{ site_id: 1, data: '2026-11-11' }, { site_id: 1, data: '2026-10-12' }, { site_id: 1, data: '2026-10-01' }], ...OWNER, ...o })
  st.tabele.executie_proiecte = [{ id: 7, data_start: '2026-09-01' }]
  return st
}
const ag = (eticheta, nr = null) => (e, n) => e === eticheta && (nr == null || n === nr)

describe('r6 P1 — termenul global acoperă TOATE așteptările (ceas simulat: apelul agățat nu se mai termină)', () => {
  // [ce, pregătire] → răspunsul pleacă la cel mult 100 s (sub cele 120 s ale cronului), iar mesajul arată ce s-a agățat
  const CAZURI = [
    // înaintea primului pas: 504 „termen depășit la <ce>”
    ['corpul cererii', { cerere: () => new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { 'x-meteo-secret': SECRET }, body: new ReadableStream({ start() {} }), duplex: 'half' }) }, 504, 'termen depășit la corpul cererii'],
    ['secretul cronului', { agata: ag('rpc:meteo_cron_secret') }, 504, 'termen depășit la secretul cronului'],
    ['verificarea utilizatorului (JWT)', { agata: ag('auth:getUser'), cerere: () => caOwner({}) }, 504, 'termen depășit la verificarea utilizatorului'],
    ['profilul (rolul) utilizatorului', { agata: ag('from:profiles'), cerere: () => caOwner({}) }, 504, 'termen depășit la profilul utilizatorului'],
    ['credențialele Xweather (cron)', { agata: ag('rpc:meteo_xweather_creds') }, 504, 'termen depășit la credențialele Xweather'],
    ['credențialele Xweather (comanda owner-ului)', { agata: ag('rpc:meteo_xweather_creds'), cerere: () => caOwner({ xweather_backfill: true, site_id: 1, de_la: '2026-10-01', pana: '2026-10-03' }) }, 504, 'termen depășit la credențialele Xweather'],
    // în pași: pasul raportează, răspunsul pleacă
    // (vremea curentă agățată până la 100 s: istoricul și pasul zilnic rămân „neajuns (termen)” → 207)
    ['vremea curentă: site-urile', { agata: ag('from:sites', 1) }, 207, 'termen depășit la site-urile'],
    ['vremea curentă: scrierea', { agata: ag('scrie:meteo_cache') }, 207, 'termen depășit la scrierea vremii curente'],
    // (fără antete de cotă de la vremea curentă: plafonul mic 10 = 5 din cele 7 zile ale șantierului activ → 207)
    ['vremea curentă: cererea Xweather', { agataRetea: (u) => (!/summary/.test(u) && u.includes('xweather') ? 'cerere' : null) }, 207, 'Xweather 0'],
    ['vremea curentă: corpul răspunsului Xweather', { agataRetea: (u) => (u.includes('xweather.com/conditions/') && !/summary/.test(u) ? 'corp' : null) }, 200, 'Xweather 200'],
    ['istoricul: site-urile', { agata: ag('from:sites', 2) }, 200, 'termen depășit la site-urile'],
    ['istoricul: cererea Open-Meteo', { agataRetea: (u) => (u.includes('open-meteo') ? 'cerere' : null) }, 200, 'termen depășit la arhiva Open-Meteo'],
    ['istoricul: corpul răspunsului Open-Meteo', { agataRetea: (u) => (u.includes('open-meteo') ? 'corp' : null) }, 200, 'răspuns ilizibil sau tăiat la termen'],
    ['istoricul: scrierea', { omOk: true, agata: ag('scrie:meteo_istoric_zilnic') }, 200, 'termen depășit la scrierea istoricului'],
    ['istoricul (owner): proiectele', { agata: ag('from:executie_proiecte'), cerere: () => caOwner({ istoric_backfill: true }) }, 200, 'termen depășit la proiectele'],
    ['pasul zilnic: site-urile', { agata: ag('from:sites', 3) }, 207, 'termen depășit la site-urile'],
    ['pasul zilnic: proiectele', { agata: ag('from:executie_proiecte') }, 207, 'termen depășit la proiectele'],
    ['pasul zilnic: rapoartele zilnice', { agata: ag('from:rapoarte_zilnice', 1) }, 207, 'termen depășit la rapoartele zilnice'],
    ['pasul zilnic: zilele existente', { agata: ag('from:v_meteo_zilnic_xweather', 1) }, 207, 'termen depășit la zilele Xweather existente'],
    ['pasul zilnic: scrierea zilei', { agata: ag('scrie:meteo_zilnic_xweather') }, 207, 'termen depășit la scrierea zilei'],
    ['pasul zilnic: cererea Xweather', { agataRetea: (u) => (/summary/.test(u) ? 'cerere' : null) }, 207, 'conditions rețea / timp depășit'],
    ['pasul zilnic: corpul răspunsului Xweather', { agataRetea: (u) => (/conditions\/summary/.test(u) ? 'corp' : null) }, 207, 'site 1 2026-11-12'],
    // (rapoartele din fereastră: pagina 1 + pagina goală = apelurile 1 și 2; restanțele = al 3-lea)
    ['restanțele vechi: rapoartele', { agata: ag('from:rapoarte_zilnice', 3) }, 200, '"restante_vechi":"neajuns (termen)"'],
    ['restanțele vechi: vremea salvată', { agata: ag('from:v_meteo_zilnic_xweather', 2) }, 200, '"restante_vechi":"neajuns (termen)"'],
  ]
  for (const [ce, { cerere, agata, ...net }, status, mesaj] of CAZURI) {
    it(`${ce}: răspunsul pleacă la ≤ 100 s, cu „${mesaj.slice(0, 50)}”`, async () => {
      const st = stareToate()
      st.agata = agata ?? null
      const r = await ruleazaCuCeas(st, { cerere: cerere?.(), ...net })
      expect(r.raspuns).toBe(true)
      expect(r.ms).toBeLessThanOrEqual(100_000)
      expect(r.ms).toBeLessThan(120_000)
      expect(r.status).toBe(status)
      expect(JSON.stringify(r.body)).toContain(mesaj)
      if (r.body.termen) expect(r.body.termen.durata_ms).toBeLessThanOrEqual(100_000)
    })
  }
  it('controlul: fără nimic agățat, aceeași stare răspunde 200 imediat (agățarea e cea care se vede mai sus)', async () => {
    const r = await ruleazaCuCeas(stareToate())
    expect(r).toMatchObject({ raspuns: true, status: 200 })
    expect(r.ms).toBeLessThan(1000)
    expect(JSON.stringify(r.body)).not.toContain('termen depășit')
  })
  // r7 (P2 r6): garanția e STRUCTURALĂ — adaptorul bazei mărginește singur orice consumare. Contraexemplul recenzentului (secretul
  // cronului prin Promise.all, fără cuTermen) și varianta cu await direct răspund tot sub termen (504, eticheta adaptorului).
  const SECRET_CU_TERMEN = "await cuTermen<RezBd<string>>(db.rpc('meteo_cron_secret'), termen, 'secretul cronului')"
  for (const [nume, in_] of [
    ['Promise.all (contraexemplul recenzentului)', "(await Promise.all([db.rpc('meteo_cron_secret')]))[0]"],
    ['await direct pe rpc', "await db.rpc('meteo_cron_secret')"],
    // (cu ambele ramuri: un .then(ok) care aruncă respingerea ar agăța oricum promisiunea proprie — nu e o așteptare a bazei)
    ['.then pe rpc', "await new Promise<any>((ok, err) => db.rpc('meteo_cron_secret').then(ok, err))"],
  ]) {
    it(`fără cuTermen în handler (${nume}), apelul agățat: răspunsul pleacă tot la ≤ 100 s (adaptorul)`, async () => {
      const st = stareToate()
      st.agata = ag('rpc:meteo_cron_secret')
      const r = await ruleazaCuCeas(st, { index: mutant(INDEX, [[SECRET_CU_TERMEN, in_]]) })
      expect(r).toMatchObject({ raspuns: true, status: 504 })
      expect(r.ms).toBeLessThanOrEqual(100_000)
      expect(r.body.error).toBe('termen depășit la funcția meteo_cron_secret')
      expect(st.consumari.filter(c => c.n !== 1)).toEqual([])
    })
  }
  it('mutant: adaptorul fără mărginire (then trecut direct la builder) + Promise.all → la 130 s răspunsul tot n-a plecat', async () => {
    const st = stareToate()
    st.agata = ag('rpc:meteo_cron_secret')
    const idx = mutant(INDEX, [[SECRET_CU_TERMEN, "(await Promise.all([db.rpc('meteo_cron_secret')]))[0]"],
      ["if (k === 'then') return (ok?: (v: any) => unknown, err?: (e: unknown) => unknown) => cuTermen(t, termen, ce).then(ok, err);", '']])
    const r = await ruleazaCuCeas(st, { index: idx })
    expect(r.raspuns).toBe(false)
    expect(r.ms).toBeGreaterThan(120_000)
  })
  it('mutant: handlerul folosește clientul brut (fără adaptor) + await direct → la 130 s răspunsul tot n-a plecat', async () => {
    const st = stareToate()
    st.agata = ag('rpc:meteo_cron_secret')
    const idx = mutant(INDEX, [[SECRET_CU_TERMEN, "await createClient('u', 'k').rpc('meteo_cron_secret')"]])
    const r = await ruleazaCuCeas(st, { index: idx })
    expect(r.raspuns).toBe(false)
  })
  it('mutant: corpul cererii fără termen → nu răspunde în 130 s', async () => {
    const idx = mutant(INDEX, [["body = await cuTermen(req.json(), termen, 'corpul cererii');", 'body = await req.json();']])
    const cerere = new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { 'x-meteo-secret': SECRET }, body: new ReadableStream({ start() {} }), duplex: 'half' })
    const r = await ruleazaCuCeas(stareToate(), { index: idx, cerere })
    expect(r.raspuns).toBe(false)
  })
})

// ── testul static: nicio așteptare în afara ajutătoarelor de termen ──
function scoateFunctie(text, antet) {
  const i = text.indexOf(antet)
  if (i < 0) throw new Error('lipsește ' + antet)
  // corpul începe cu acolada de la sfârșitul liniei antetului
  let j = text.lastIndexOf('{', text.indexOf('\n', i)), ad = 0
  if (j < i) throw new Error('antet fără acoladă: ' + antet)
  for (let k = j; k < text.length; k++) {
    if (text[k] === '{') ad++
    else if (text[k] === '}' && --ad === 0) return text.slice(0, i) + text.slice(k + 1)
  }
  throw new Error('acoladă neînchisă')
}
// așteptările permise: cele două ajutătoare de termen, clientul Xweather (trece prin cerereRetea), pauza mărginită și funcțiile interne
// (verificate mai jos că sunt definite în fișier și că ele însele respectă regula)
const PERMISE = ['cuTermen', 'cerereRetea', 'xw', 'dormi', 'Promise.all', 'sincronizeazaIstoric', 'sincronizeazaXweather', 'vremeaCurenta',
  'zileCuRaport', 'zileXweatherExistente', 'restanteVechi', 'restante', 'proceseaza', 'utilizator']
// r7: a doua plasă — clientul brut (createClient, .auth) și consumarea directă (.then) apar DOAR în adaptor (bazaCuTermen), fetch-ul DOAR în
// cerereRetea. (Prima plasă e structurală: adaptorul mărginește orice consumare, testele cu ceas de mai sus.)
const ANTET_ADAPTOR = 'function bazaCuTermen('
function atingeriBrute(text) {
  const faraAdaptor = scoateFunctie(text, ANTET_ADAPTOR)
  const faraRetea = scoateFunctie(text, 'async function cerereRetea(')
  const linii = (t, re) => t.split('\n').filter(l => re.test(l) && !/^import /.test(l)).map(l => l.trim())
  return [...linii(faraAdaptor, /\bcreateClient\s*\(|\.auth\b|\.then\s*\(/), ...linii(faraRetea, /\bfetch\s*\(/)]
}
// doar corpul lui cuTermen e scos (singurul `await` „brut”, pe cursa cu termenul); cerereRetea rămâne în analiză: și fetch-ul, și corpul
// răspunsului trebuie așteptate prin cuTermen
function asteptariNeacoperite(text) {
  const fara = scoateFunctie(text, 'async function cuTermen<')
  return [...fara.matchAll(/\bawait\s+([\w.]+)(<[^(]*>)?\(/g)].map(m => m[1]).filter(n => !PERMISE.includes(n))
    .concat([...fara.matchAll(/\bawait\s+(?![\w.]+(<[^(]*>)?\()([^;\n]{0,40})/g)].map(m => 'neidentificat: ' + m[2]))
}
describe('r6 P1 — testul static al așteptărilor (index.ts)', () => {
  it('în handler nu rămâne niciun await pe client / rețea în afara ajutătorului de termen', () => {
    expect(asteptariNeacoperite(INDEX)).toEqual([])
    // funcțiile interne permise există în fișier; nimic nu consumă builderul cu .then( direct
    for (const f of ['sincronizeazaIstoric', 'sincronizeazaXweather', 'vremeaCurenta', 'zileCuRaport', 'zileXweatherExistente', 'restanteVechi', 'proceseaza'])
      expect(INDEX).toMatch(new RegExp(`async function ${f}\\(`))
    expect(INDEX).toContain('const restante = () => restanteVechi(')
    // un singur fetch, în cerereRetea, așteptat prin cuTermen
    expect(INDEX.match(/\bfetch\(/g)).toHaveLength(1)
    expect(INDEX).toContain('await cuTermen(fetch(url, { signal: ctl.signal }), lim, ce)')
  })
  it('r7: clientul brut / .then / fetch nu apar în afara adaptorului (respectiv cerereRetea); handlerul ia doar adaptorul', () => {
    expect(atingeriBrute(INDEX)).toEqual([])
    // adaptorul există și e singura sursă a clientului din handler
    expect(INDEX).toContain("const { db, utilizator } = bazaCuTermen(Deno.env.get('SUPABASE_URL')!, termen);")
    expect(INDEX.match(/\bcreateClient\(/g)).toHaveLength(2)
    expect(scoateFunctie(INDEX, ANTET_ADAPTOR)).not.toMatch(/\bcreateClient\(/)
  })
  for (const [nume, din, in_] of [
    ['clientul brut în handler', "const { db, utilizator } = bazaCuTermen(Deno.env.get('SUPABASE_URL')!, termen);",
      "const { utilizator } = bazaCuTermen(Deno.env.get('SUPABASE_URL')!, termen); const db = createClient('u', 'k');"],
    ['.auth în handler', 'const { data } = await utilizator(jwt);', "const { data } = await cuTermen(createClient('u', 'k').auth.getUser(), termen, 'x');"],
    ['contraexemplul recenzentului cu .then', "await cuTermen<RezBd<string>>(db.rpc('meteo_cron_secret'), termen, 'secretul cronului')",
      "await new Promise<any>((ok) => db.rpc('meteo_cron_secret').then(ok))"],
    ['un al doilea fetch', "const resp = await cerereRetea(urlArhiva(", 'const resp = await cuTermen(fetch(urlArhiva('],
  ]) {
    it(`mutant: ${nume} → a doua plasă (statică) pică`, () => {
      expect(atingeriBrute(mutant(INDEX, [[din, in_]])).length).toBeGreaterThan(0)
    })
  }
  for (const [nume, din, in_] of [
    ['autentificarea cronului', "await cuTermen<RezBd<string>>(db.rpc('meteo_cron_secret'), termen, 'secretul cronului')", "await db.rpc('meteo_cron_secret')"],
    ['utilizatorul', "await cuTermen(uc.auth.getUser(), termen, 'verificarea utilizatorului')", 'await uc.auth.getUser()'],
    ['credențialele', "await cuTermen<RezBd<Creds>>(db.rpc('meteo_xweather_creds'), termen, 'credențialele Xweather');\n  const cid", "await db.rpc('meteo_xweather_creds');\n  const cid"],
    ['scrierea zilei', "await cuTermen(db.from('meteo_zilnic_xweather').insert(z.rand), termenGlobal, 'scrierea zilei')", "await db.from('meteo_zilnic_xweather').insert(z.rand)"],
    ['fetch-ul', 'await cuTermen(fetch(url, { signal: ctl.signal }), lim, ce)', 'await fetch(url, { signal: ctl.signal })'],
    ['corpul răspunsului', 'await cuTermen(r.json(), lim, ce)', 'await r.json()'],
    ['corpul cererii', "await cuTermen(req.json(), termen, 'corpul cererii')", 'await req.json()'],
    ['restanțele vechi', "await cuTermen<RezBd<{ site_id: number; data: string }[]>>(db.from('rapoarte_zilnice')", "await (db.from('rapoarte_zilnice')"],
  ]) {
    it(`mutant: ${nume} fără termen → testul static pică`, () => {
      expect(asteptariNeacoperite(mutant(INDEX, [[din, in_]])).length).toBeGreaterThan(0)
    })
  }
})

describe('r6 P1 — ajutătorul de termen consumă fiecare „thenable” O SINGURĂ dată (o consumare = o cerere)', () => {
  it('rularea completă: fiecare builder / rpc / auth consumat exact o dată', async () => {
    const st = stareToate()
    const { body } = await ruleaza(st)
    expect(body.ok).toBe(true)
    expect(st.consumari.length).toBeGreaterThan(8)
    expect(st.consumari.filter(c => c.n !== 1)).toEqual([])
  })
  it('mutant: cuTermen care consumă de două ori (Promise.resolve(p) dublat) → fiecare cerere ar pleca de două ori', async () => {
    const st = stareToate()
    await ruleaza(st, { index: mutant(INDEX, [['Promise.race([Promise.resolve(p), ', 'Promise.race([Promise.resolve(p), Promise.resolve(p), ']]) })
    // r7: cuTermen e folosit și de adaptor (exterior + interior) → dublarea se vede de 2 × 2 = 4 ori pe builder
    expect(st.consumari.some(c => c.n >= 2)).toBe(true)
  })
})

describe('r6 P1 — restanțele au partea lor din plafon (contraexemplul recenzentului, în handler)', () => {
  // cota necunoscută (fără antete de cotă) → plafon 10 = pas 5; șantierele 1..10 active, cu vreme pe 06..11.11 → doar „ieri” (12.11) lipsește;
  // șantierul 11, inactiv, are 10 zile cu raport și fără vreme (20..29.10) = restanțele
  const fara = ({ ep, status }) => (status >= 200 && status < 300 ? { 'X-Cost-Tokens': String(COST_DOC[ep]) } : {})
  const stareRecenzent = () => stare({
    sites: Array.from({ length: 11 }, (_, i) => santier(i + 1)),
    rapoarte: [...Array.from({ length: 10 }, (_, i) => ({ site_id: i + 1, data: '2026-11-11' })), ...zileInapoi('2026-10-29', 10).map(data => ({ site_id: 11, data }))],
    vreme: Array.from({ length: 10 }, (_, i) => zileInapoi('2026-11-11', 6).map(z => vremeZi(i + 1, z))).flat(),
  })
  it('plafon 10: 3 zile „ieri” + 2 restanțe (nu 5 + 0); părțile în rezultat', async () => {
    const st = stareRecenzent()
    const { body } = await ruleaza(st, { antete: fara })
    const c = cereriCond(st)
    expect(c).toHaveLength(5)
    expect(c.filter(x => x.endsWith(':2026-11-12'))).toHaveLength(3)
    expect(c.filter(x => x.startsWith('11:'))).toHaveLength(2)
    expect(body.xweather.rotatie).toMatchObject({ pas: 5, parti: { pas: 5, rezervat_restante: 2, rezervat_ieri: 3, ieri: 3, restante: 2 } })
    expect(body.xweather).toMatchObject({ scrise: 5, unitati_xweather: 10, neajunse: 15 })
  })
  it('mutant: prioritatea fixă „ieri” (nicio rezervă) → 5 „ieri”, 0 restanțe (reproduce contraexemplul)', async () => {
    const st = stareRecenzent()
    await ruleaza(st, { antete: fara, logica: mutant(LOGICA, [['p >= 2 ? Math.min(p - 1, Math.max(1, Math.ceil(p / PARTE_RESTANTE))) : indexZi(ieri) % 2', '0']]) })
    expect(cereriCond(st).filter(x => x.startsWith('11:'))).toHaveLength(0)
  })
})

describe('r6 P2 — restanțele ieșite din fereastră (restante_vechi), doar la pasul zilnic cu întrerupătorul pornit', () => {
  // fereastra începe la 13.10 (ieri 12.11 − 30); 12.10 și 01.10 au raport fără vreme; 15.09 are raport ȘI vreme (completată de owner)
  const stareVechi = () => stare({ sites: [santier(1)], rapoarte: ['2026-10-12', '2026-10-01', '2026-09-15'].map(data => ({ site_id: 1, data })),
    vreme: [vremeZi(1, '2026-09-15')] })
  it('numărul, cea mai veche zi, exemplele; nicio cerere către furnizor pentru ele', async () => {
    const st = stareVechi()
    const { body, status } = await ruleaza(st)
    expect(body.xweather.restante_vechi).toEqual({ numar: 2, verificate: 3, exact: true, cea_mai_veche: '2026-10-01', inainte_de: '2026-10-13',
      exemple: [{ site_id: 1, zi: '2026-10-01' }, { site_id: 1, zi: '2026-10-12' }], sens: expect.stringContaining('restanțe confirmate') })
    expect(body.xweather.nimic_de_facut).toBe(true)
    expect(st.zilnic).toHaveLength(0)
    expect(status).toBe(200)
  })
  it('cel mult 10 exemple; pagina plină (1000 de rapoarte) = cifra e un minim (exact: false)', async () => {
    const zile = Array.from({ length: 1001 }, (_, i) => new Date(Date.parse('2023-01-01T12:00:00Z') + i * 864e5).toISOString().slice(0, 10))
    const st = stare({ sites: [santier(1)], rapoarte: zile.map(data => ({ site_id: 1, data })) })
    const { body } = await ruleaza(st)
    expect(body.xweather.restante_vechi).toMatchObject({ numar: 1000, exact: false, cea_mai_veche: '2023-01-01' })
    expect(body.xweather.restante_vechi.exemple).toHaveLength(10)
  })
  it('fără timp rămas: „neajuns (termen)”, nu zero', async () => {
    // vremea curentă durează 62 s → pasul zilnic are termenul global (100 s); zilele de 6 s pornesc la 62..92 s, la 98 s rămân 2 s < 5 s
    const st = stare({ sites: [santier(1), sediu(9)], rapoarte: [...zileInapoi('2026-10-29', 10), '2026-10-01'].map(data => ({ site_id: 1, data })) })
    const { body } = await ruleaza(st, { curentPasMs: 62_000, pasMs: 3000 })
    expect(cereriCond(st)).toHaveLength(6)
    expect(body.xweather.restante_vechi).toBe('neajuns (termen)')
    expect(body.termen.durata_ms).toBeLessThanOrEqual(100_000)
  })
  it('întrerupătorul oprit: nicio citire (nici rapoarte, nici vremea), niciun câmp', async () => {
    const st = stareVechi()
    const { body } = await ruleaza(st, { env: { XW_ZILNIC_ACTIV: undefined } })
    expect(st.citite).not.toContain('rapoarte_zilnice')
    expect(st.citite).not.toContain('v_meteo_zilnic_xweather')
    expect(JSON.stringify(body)).not.toContain('restante_vechi')
  })
  it('mutant: lipsa timpului raportată ca zero → testul „neajuns (termen)” pică', async () => {
    const st = stare({ sites: [santier(1), sediu(9)], rapoarte: [...zileInapoi('2026-10-29', 10), '2026-10-01'].map(data => ({ site_id: 1, data })) })
    const idx = mutant(INDEX, [['  if (termen - Date.now() < MIN_TIMP_PAS_MS) return NEAJUNS_TERMEN;\n  const gol', '  const gol'],
      ['    return e instanceof TermenDepasit ? NEAJUNS_TERMEN :', '    return e instanceof TermenDepasit ? { numar: 0 } :']])
    const { body } = await ruleaza(st, { curentPasMs: 62_000, pasMs: 3000, index: idx })
    expect(body.xweather.restante_vechi).not.toBe('neajuns (termen)')
  })
  it('mutant: fără limita ferestrei la citire → numără și zilele din fereastră', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: ['2026-10-20', '2026-10-01'].map(data => ({ site_id: 1, data })) })
    const idx = mutant(INDEX, [[".gte('data', PRIMA_ZI_XW).lt('data', de).order('data', { ascending: true }).order('id'",
      ".gte('data', PRIMA_ZI_XW).order('data', { ascending: true }).order('id'"]])
    const { body } = await ruleaza(st, { index: idx })
    expect(body.xweather.restante_vechi.numar).not.toBe(1)
    const { body: b2 } = await ruleaza(stare({ sites: [santier(1)], rapoarte: ['2026-10-20', '2026-10-01'].map(data => ({ site_id: 1, data })) }))
    expect(b2.xweather.restante_vechi.numar).toBe(1)
  })
})

// r7 (P2 r6): „are vreme” se stabilește pe ACELEAȘI zile-șantier citite ca rapoarte; vremea lor e citită până la capăt (pe chei)
describe('r7 P2 — restante_vechi: doar restanțe confirmate, vremea citită până la capăt', () => {
  const zileDe = (de, k) => Array.from({ length: k }, (_, i) => new Date(Date.parse(de + 'T12:00:00Z') + i * 864e5).toISOString().slice(0, 10))
  // contraexemplul recenzentului: rapoarte la 01.01.2023 și 01.10.2026, ambele CU vreme; între ele încă 999 de zile cu vreme (1001 > 1000)
  const MIJLOC = zileDe('2023-01-02', 999)
  const stareRecenzent = ({ faraVremeLa = null } = {}) => stare({ sites: [santier(1)],
    rapoarte: ['2023-01-01', '2026-10-01'].map(data => ({ site_id: 1, data })),
    vreme: ['2023-01-01', ...MIJLOC, '2026-10-01'].filter(z => z !== faraVremeLa).map(z => vremeZi(1, z)) })
  it('contraexemplul recenzentului: zero restanțe (r6 spunea 1, cu octombrie în exemple), exact: true, 2 verificate', async () => {
    expect(MIJLOC.at(-1) < '2026-10-01').toBe(true)
    const { body } = await ruleaza(stareRecenzent())
    expect(body.xweather.restante_vechi).toMatchObject({ numar: 0, verificate: 2, exact: true, cea_mai_veche: null, exemple: [] })
  })
  it('invers: vremea lipsă chiar la capătul intervalului (01.10.2026, după 1000 de zile cu vreme) → prinsă', async () => {
    const { body } = await ruleaza(stareRecenzent({ faraVremeLa: '2026-10-01' }))
    expect(body.xweather.restante_vechi).toMatchObject({ numar: 1, verificate: 2, exact: true, cea_mai_veche: '2026-10-01',
      exemple: [{ site_id: 1, zi: '2026-10-01' }] })
  })
  it('vremea pe alt șantier în aceeași zi nu acoperă raportul (perechea contează, nu ziua)', async () => {
    const st = stare({ sites: [santier(1), santier(2)], rapoarte: [{ site_id: 1, data: '2026-10-01' }], vreme: [vremeZi(2, '2026-10-01')] })
    const { body } = await ruleaza(st)
    expect(body.xweather.restante_vechi).toMatchObject({ numar: 1, verificate: 1, exemple: [{ site_id: 1, zi: '2026-10-01' }] })
  })
  it('pagina de rapoarte plină: exact: false, numar = minim ADEVĂRAT (restanțele confirmate printre cele 1000 verificate)', async () => {
    // 1001 rapoarte (01.01.2023 …); vremea pe zilele de rang impar → în pagină 500 fără vreme; al 1001-lea (rang 1000, par) tot fără vreme
    const zile = zileDe('2023-01-01', 1001)
    const st = stare({ sites: [santier(1)], rapoarte: zile.map(data => ({ site_id: 1, data })), vreme: zile.filter((_, i) => i % 2).map(z => vremeZi(1, z)) })
    const { body } = await ruleaza(st)
    const adevarat = zile.filter((_, i) => i % 2 === 0).length   // 501 (sursa: datele de test, nu codul)
    expect(body.xweather.restante_vechi).toMatchObject({ numar: 500, verificate: 1000, exact: false, cea_mai_veche: '2023-01-01' })
    expect(body.xweather.restante_vechi.numar).toBeLessThanOrEqual(adevarat)
    // fiecare exemplu e o zi verificată complet: raport prezent, vreme absentă
    for (const e of body.xweather.restante_vechi.exemple) {
      expect(zile.indexOf(e.zi) % 2).toBe(0)
      expect(zile.indexOf(e.zi)).toBeLessThan(1000)
    }
  })
  it('termen atins în timpul citirii vremii (a doua pagină agățată) → „neajuns (termen)”, nu o cifră; răspunsul la ≤ 100 s', async () => {
    const st = stareRecenzent()
    // fără rapoarte în fereastră, zilele existente nu se citesc: apelul 1 = prima pagină a vremii vechi (1000), 2 = a doua (agățată)
    st.agata = ag('from:v_meteo_zilnic_xweather', 2)
    const r = await ruleazaCuCeas(st)
    expect(r.raspuns).toBe(true)
    expect(r.ms).toBeLessThanOrEqual(100_000)
    expect(r.body.xweather.restante_vechi).toBe('neajuns (termen)')
  })
  it('mutant: citirea vremii oprită după prima pagină → contraexemplul dă din nou o restanță inexistentă (pică)', async () => {
    const idx = mutant(INDEX, [['        ultimaV = u;\n', '        ultimaV = u; break;\n']])
    const { body } = await ruleaza(stareRecenzent(), { index: idx })
    expect(body.xweather.restante_vechi.numar).toBe(1)
    expect(body.xweather.restante_vechi.exemple).toEqual([{ site_id: 1, zi: '2026-10-01' }])
  })
  it('mutant: vremea citită pe toate șantierele (fără perechea șantier-zi) → raportul acoperit de vremea altui șantier (pică)', async () => {
    const st = stare({ sites: [santier(1), santier(2)], rapoarte: [{ site_id: 1, data: '2026-10-01' }], vreme: [vremeZi(2, '2026-10-01')] })
    const idx = mutant(INDEX, [["for (const v of vr) zile.delete(`${s}|${v.data}`);", 'for (const v of vr) for (const k of [...zile.keys()]) if (k.endsWith(`|${v.data}`)) zile.delete(k);'],
      [".select('data').eq('site_id', s)", ".select('data').in('site_id', [1, 2])"]])
    const { body } = await ruleaza(st, { index: idx })
    expect(body.xweather.restante_vechi.numar).toBe(0)
  })
})

describe('r6 — XW_AER_PE_ZI: rezultatul spune de unde vine valoarea', () => {
  const sursa = async (v) => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { env: { XW_AER_PE_ZI: v } })
    return body.cota
  }
  it('setată / implicită (lipsă) / invalidă → implicită (inclusiv șirul gol)', async () => {
    expect(await sursa('2')).toMatchObject({ aer_pe_zi: 2, aer_pe_zi_sursa: 'setata', aer_pe_zi_invalid: null })
    expect(await sursa(undefined)).toMatchObject({ aer_pe_zi: 4, aer_pe_zi_sursa: 'implicita', aer_pe_zi_invalid: null })
    expect(await sursa('')).toMatchObject({ aer_pe_zi: 4, aer_pe_zi_sursa: 'invalida', aer_pe_zi_invalid: '' })
    expect(await sursa('x')).toMatchObject({ aer_pe_zi: 4, aer_pe_zi_sursa: 'invalida', aer_pe_zi_invalid: 'x' })
  })
  it('mutant: șirul gol tratat ca lipsă (comportamentul r5) → sursa nu mai e „invalida”', async () => {
    const st = stare({ sites: [sediu(5)] })
    const { body } = await ruleaza(st, { env: { XW_AER_PE_ZI: '' }, cota: mutant(COTA, [["  if (v == null) return { n: AER_PE_ZI_IMPLICIT, invalid: null, sursa: 'implicita' }",
      "  if (v == null || v === '') return { n: AER_PE_ZI_IMPLICIT, invalid: null, sursa: 'implicita' }"]]) })
    expect(body.cota.aer_pe_zi_sursa).not.toBe('invalida')
  })
})
