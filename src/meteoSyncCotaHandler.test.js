// r4 — handler-ul meteo-sync (supabase/functions/meteo-sync/index.ts) rulat ÎNTREG, cu BD și rețea simulate: cron-ul de la 04:05 UTC cere
// vremea zilei doar pentru țintele r4, se oprește exact la plafonul de accese și la termen, numără și cererile eșuate, nu mai reverifică
// automat, iar comanda owner-ului rămâne doar a owner-ului (403). Mutanții (copii stricate intenționat ale index.ts / logicii) TREBUIE să
// pice (L25). Copiile se scriu într-un folder temporar (importul npm:@supabase/supabase-js e înlocuit cu clientul simulat), apoi se șterg.
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DIR = new URL('../supabase/functions/meteo-sync/', import.meta.url)
const citeste = (f) => readFileSync(new URL(f, DIR), 'utf8').replace(/\r\n/g, '\n')
const INDEX = citeste('index.ts')
const LOGICA = citeste('xweather_zilnic_logica.ts')
const ISTORIC = citeste('istoric_logica.ts')
const IMPORT_SUPA = "import { createClient } from 'npm:@supabase/supabase-js@2';"
const TMP = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'xw-handler-')))
afterAll(() => rmSync(TMP, { recursive: true, force: true }))

const ENV = { SUPABASE_URL: 'http://bd.test', SUPABASE_SERVICE_ROLE_KEY: 'cheie-serviciu', SUPABASE_ANON_KEY: 'cheie-anon' }
let n = 0
async function incarcaHandler({ index = INDEX, logica = LOGICA } = {}) {
  if (!index.includes(IMPORT_SUPA)) throw new Error('importul supabase-js s-a schimbat')
  const d = path.join(TMP, `h${n++}`)
  mkdirSync(d)
  writeFileSync(path.join(d, 'index.ts'), index.replace(IMPORT_SUPA, 'const { createClient } = (globalThis as any).__xwSupabase;'))
  writeFileSync(path.join(d, 'xweather_zilnic_logica.ts'), logica)
  writeFileSync(path.join(d, 'istoric_logica.ts'), ISTORIC)
  let handler = null
  globalThis.Deno = { serve: (h) => { handler = h }, env: { get: (k) => ENV[k] } }
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
    scrise: {}, useri, zilnic: [], curente: 0, timpi: [],
    rpc: { meteo_cron_secret: SECRET, meteo_xweather_creds: { client_id: 'ID', client_secret: 'SEC' } },
  }
}
function clientSimulat(st) {
  return (_url, _cheie, opt) => {
    const tok = (opt?.global?.headers?.Authorization || '').replace(/^Bearer /, '')
    const from = (nume) => {
      const filtre = []
      let ordine = null, limita = null, unic = false, scriere = null
      const exec = () => {
        if (scriere) { (st.scrise[nume] ||= []).push(...[].concat(scriere)); return { data: null, error: null } }
        let rows = (st.tabele[nume] || []).filter(r => filtre.every(f => f(r)))
        if (ordine) rows = [...rows].sort((a, b) => (a[ordine[0]] < b[ordine[0]] ? -1 : a[ordine[0]] > b[ordine[0]] ? 1 : 0) * (ordine[1] ? 1 : -1))
        if (limita != null) rows = rows.slice(0, limita)
        return unic ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
      }
      const q = {
        select: () => q,
        eq: (c, v) => (filtre.push(r => r[c] === v), q),
        gte: (c, v) => (filtre.push(r => r[c] >= v), q),
        lte: (c, v) => (filtre.push(r => r[c] <= v), q),
        gt: (c, v) => (filtre.push(r => r[c] > v), q),
        in: (c, vs) => (filtre.push(r => vs.includes(r[c])), q),
        order: (c, o = {}) => ((ordine = [c, o.ascending !== false]), q),
        limit: (k) => ((limita = k), q),
        maybeSingle: () => ((unic = true), q),
        insert: (row) => ((scriere = row), q),
        upsert: (row) => ((scriere = row), q),
        then: (ok, err) => Promise.resolve().then(exec).then(ok, err),
      }
      return q
    }
    return {
      from, rpc: async (f) => ({ data: st.rpc[f] ?? null, error: null }),
      auth: { getUser: async () => ({ data: { user: st.useri[tok] ? { id: st.useri[tok] } : null } }) },
    }
  }
}

// ── rețeaua simulată: Xweather (vremea zilei + vremea curentă), Open-Meteo ──
const XW = 'https://data.api.xweather.com/'
const json = (o, status = 200) => new Response(JSON.stringify(o), { status })
const condOk = (zi) => ({ success: true, error: null, response: [{ loc: { lat: 44, long: 26 }, profile: { tz: 'Europe/Bucharest' },
  periods: [{ dateTimeISO: `${zi}T00:00:00+02:00`, temp: { minC: 1, maxC: 9, avgC: 5 }, precip: { totalMM: 2 } }] }] })
const obsOk = (zi) => ({ success: true, error: null, response: [{ id: 'LRBS', place: { name: 'Baneasa' }, relativeTo: { distanceKM: 12 },
  loc: { lat: 44.5, long: 26.08 }, periods: [{ summary: { dateTimeISO: `${zi}T00:00:00+02:00` } }] }] })
// raspuns({ ep, site, zi }) → 'ok' | 'retea' | { status, json }; pasMs = cât „durează” fiecare cerere a pasului zilnic (ceasul simulat)
function retea(st, siteDupaLat, { raspuns = () => 'ok', pasMs = 0 } = {}) {
  globalThis.fetch = async (url) => {
    const u = String(url)
    if (u.includes('open-meteo.com')) return json({}, 503)
    if (!u.startsWith(XW)) throw new Error('rețea neașteptată: ' + u)
    const c = u.slice(XW.length)
    if (!c.startsWith('conditions/summary/') && !c.startsWith('observations/summary/')) {
      st.curente++
      return json({ success: true, error: null, response: [{ periods: [{ tempC: 5, weather: 'Cloudy' }] }] })
    }
    if (!/&client_id=ID&client_secret=SEC$/.test(c)) throw new Error('credențiale lipsă în cerere')
    const ep = c.startsWith('conditions') ? 'conditions' : 'observations'
    const lat = Number(/(?:summary\/|p=)(-?[\d.]+),/.exec(c)[1])
    const from = Number(/from=(\d+)/.exec(c)[1])
    const zi = new Date((from + 3 * 3600) * 1000).toISOString().slice(0, 10)
    const site = siteDupaLat.get(lat)
    st.zilnic.push({ ep, site, zi })
    st.timpi.push(Date.now())
    if (pasMs) vi.setSystemTime(Date.now() + pasMs)
    const r = raspuns({ ep, site, zi })
    if (r === 'retea') throw new TypeError('fetch failed')
    if (r === 'ok') return json(ep === 'conditions' ? condOk(zi) : obsOk(zi))
    return json(r.json ?? {}, r.status)
  }
}
const santier = (id, o = {}) => ({ id, name: 'S' + id, lat: 44 + id / 10, lng: 26, proiect_id: null, active: true, meteo_activ: true,
  tip_locatie: 'santier', raport_zilnic_necesar: false, localitate_meteo: null, ...o })
const vremeZi = (site_id, data) => ({ site_id, data, versiune: 1, tmax_c: 9, observatii_stare: 'ok', statie_id: 'LRBS' })
const zileInapoi = (de, k) => Array.from({ length: k }, (_, i) => new Date(Date.parse(de + 'T12:00:00Z') - i * 864e5).toISOString().slice(0, 10))

let fetchVechi
beforeEach(() => {
  fetchVechi = globalThis.fetch
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T04:05:00Z'))   // rularea cron de la 04:05 UTC; azi = 13.11, ieri = 12.11 (ora României)
})
afterEach(() => { vi.useRealTimers(); globalThis.fetch = fetchVechi; delete globalThis.Deno; delete globalThis.__xwSupabase })

async function ruleaza(st, { index, logica, raspuns, pasMs, cerere } = {}) {
  globalThis.__xwSupabase = { createClient: clientSimulat(st) }
  retea(st, new Map(st.tabele.sites.map(s => [s.lat, s.id])), { raspuns, pasMs })
  const h = await incarcaHandler({ index, logica })
  const req = cerere || new Request('http://functie.test/meteo-sync', { method: 'POST', headers: { 'x-meteo-secret': SECRET }, body: '{}' })
  const res = await h(req)
  return { status: res.status, body: await res.json() }
}
const cereriCond = (st) => st.zilnic.filter(x => x.ep === 'conditions').map(x => `${x.site}:${x.zi}`)

// scenariul țintelor: 1 = raport acum 13 zile (activ); 2 = raport acum 15 zile (inactiv, ziua lui fără vreme); 3 = raport cu vreme;
// 4 = fără rapoarte; 5 = sediul (vremea curentă, fără rapoarte)
const stareTinte = () => stare({
  sites: [santier(1), santier(2), santier(3), santier(4), santier(5, { tip_locatie: 'sediu' })],
  rapoarte: [{ site_id: 1, data: '2026-10-31' }, { site_id: 2, data: '2026-10-29' }, { site_id: 3, data: '2026-10-20' }],
  vreme: [vremeZi(3, '2026-10-20')],
})
const TINTE_ASTEPTATE = [...zileInapoi('2026-11-12', 7).map(z => `1:${z}`), '1:2026-10-31', '2:2026-10-29']

// scenariul plafonului: șantierul 1 activ cu fereastra completă + 40 de zile cu raport fără vreme (10.10 → 01.09)
const starePlafon = () => {
  const zile = zileInapoi('2026-10-10', 40)
  return stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-12' }, ...zile.map(data => ({ site_id: 1, data }))],
    vreme: zileInapoi('2026-11-12', 7).map(z => vremeZi(1, z)) })
}

describe('cron 04:05 UTC: țintele r4', () => {
  it('cere doar (a) șantierul activ (ieri + reluarea) și (b) zilele cu raport fără vreme, cele mai noi întâi; vremea curentă neschimbată', async () => {
    const st = stareTinte()
    const { status, body } = await ruleaza(st)
    expect(status).toBe(200)
    expect(cereriCond(st)).toEqual(TINTE_ASTEPTATE)
    expect(body.xweather).toMatchObject({ ok: true, complet: true, scrise: 9, accese_xweather: 18, plafon_accese: 60, buget_ms: 40_000,
      sarcini_pe_tinta: { activ: 7, raport: 2 }, santiere_active: [1], oprit: null })
    expect(body.accese_xweather).toBe(18)
    expect(st.scrise.meteo_zilnic_xweather).toHaveLength(9)
    // vremea curentă: sediul, cu prognoza / alertele / aerul la ora 04 UTC (4 cereri), ca înainte
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

describe('plafonul de accese și numărătoarea', () => {
  it('se oprește exact la 60: 30 de zile (cele mai noi), 10 „neajunsă (plafonul de accese)”, HTTP 207, complet:false', async () => {
    const st = starePlafon()
    const { status, body } = await ruleaza(st)
    expect(st.zilnic).toHaveLength(60)
    expect(cereriCond(st)).toEqual(zileInapoi('2026-10-10', 30).map(z => `1:${z}`))
    expect(status).toBe(207)
    expect(body.xweather).toMatchObject({ ok: false, complet: false, scrise: 30, neajunse: 10, nr_nesalvate: 10, accese_xweather: 60 })
    expect(body.xweather.zile_nesalvate.map(x => x.motiv)).toEqual(Array(10).fill('neajunsă (plafonul de accese)'))
    expect(body.xweather.zile_nesalvate[0].zi).toBe('2026-09-10')
    expect(body.xweather_ok).toBe(false)
  })
  it('zilele fără date costă un acces: plafonul tot nu e depășit (59 de zile, 59 de accese)', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 70).map(data => ({ site_id: 1, data })) })
    const { body } = await ruleaza(st, { raspuns: ({ ep }) => (ep === 'conditions' ? { status: 200, json: { success: true, error: { code: 'warn_no_data' }, response: [] } } : 'ok') })
    expect(body.xweather.accese_xweather).toBe(59)
    expect(st.zilnic).toHaveLength(59)
    expect(body.xweather.lipsa).toBe(59)
  })
  it('numărătoarea include cererile eșuate (503, rețea, observații 502)', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 5).map(data => ({ site_id: 1, data })) })
    const rasp = ({ ep, zi }) => {
      if (zi === '2026-10-10') return { status: 503, json: null }
      if (zi === '2026-10-09') return 'retea'
      if (zi === '2026-10-08' && ep === 'observations') return { status: 502, json: null }
      return 'ok'
    }
    const { status, body } = await ruleaza(st, { raspuns: rasp })
    expect(body.xweather.accese_xweather).toBe(1 + 1 + 2 + 2 + 2)
    expect(body.xweather).toMatchObject({ scrise: 2, tranzitorii: 3, nr_nesalvate: 3 })
    expect(status).toBe(207)
  })
  it('429 la conditions oprește toată rularea: un singur acces, restul „neajunsă (oprit: …)”', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 5).map(data => ({ site_id: 1, data })) })
    const { body } = await ruleaza(st, { raspuns: () => ({ status: 429, json: { success: false } }) })
    expect(body.xweather.accese_xweather).toBe(1)
    expect(body.xweather.oprit).toMatch(/limita de accese/)
    expect(body.xweather.zile_nesalvate.slice(1).every(x => /^neajunsă \(oprit: limita de accese/.test(x.motiv))).toBe(true)
  })
})

describe('termenul pasului zilnic (40 s)', () => {
  it('cu 3 s pe cerere: 6 zile, restul „neajunsă (bugetul de timp)”; nicio cerere după termen', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 20).map(data => ({ site_id: 1, data })) })
    const { status, body } = await ruleaza(st, { pasMs: 3000 })
    expect(cereriCond(st)).toHaveLength(6)
    expect(body.xweather).toMatchObject({ accese_xweather: 12, neajunse: 14, scrise: 6 })
    expect(body.xweather.zile_nesalvate.map(x => x.motiv)).toEqual(Array(14).fill('neajunsă (bugetul de timp)'))
    expect(Math.max(...st.timpi) - Math.min(...st.timpi)).toBeLessThan(40_000)
    expect(body.xweather.durata_ms).toBeLessThanOrEqual(40_000)
    expect(status).toBe(207)
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
  it('owner, max_zile 40: 31 de zile (62 de accese = plafonul apelului), 9 neajunse, reluarea de la prima neajunsă', async () => {
    vi.setSystemTime(new Date('2026-11-13T09:30:00Z'))
    const st = stareOwner()
    const { status, body } = await ruleaza(st, { cerere: cu('tok-owner', { xweather_backfill: true, site_id: 1, de_la: '2026-09-01', pana: '2026-10-31', max_zile: 40 }) })
    expect(status).toBe(207)
    expect(body.xweather).toMatchObject({ accese_xweather: 62, plafon_accese: 62, scrise: 31, neajunse: 9, continua_pana: '2026-09-30', buget_ms: 100_000 })
    expect(st.zilnic).toHaveLength(62)
  })
})

describe('mutanții (țintele vechi, plafon ignorat, numărătoare fără eșecuri, termen ignorat) pică', () => {
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
  it('M2 plafon ignorat: trece de 60 de accese', async () => {
    const st = starePlafon()
    const { body } = await ruleaza(st, { index: mutant(INDEX, [['poateIncepeZi(accese, plafon, Date.now(), termen)', 'poateIncepeZi(0, plafon, Date.now(), termen)']]) })
    expect(st.zilnic.length).toBeGreaterThan(60)
    expect(body.xweather.accese_xweather).toBeGreaterThan(60)
  })
  it('M3 numărătoarea sare cererile eșuate: accese_xweather mai mic decât cererile trimise', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 3).map(data => ({ site_id: 1, data })) })
    const idx = mutant(INDEX, [['    accese++;\n    const ctl', '    const ctl'],
      ['{ signal: ctl.signal });\n      return { status: r.status', '{ signal: ctl.signal });\n      if (r.ok) accese++;\n      return { status: r.status']])
    const { body } = await ruleaza(st, { index: idx, raspuns: ({ zi }) => (zi === '2026-10-10' ? { status: 503, json: null } : zi === '2026-10-09' ? 'retea' : 'ok') })
    expect(st.zilnic).toHaveLength(4)
    expect(body.xweather.accese_xweather).not.toBe(4)
  })
  it('M4 termenul ignorat: continuă după 40 s', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: zileInapoi('2026-10-10', 20).map(data => ({ site_id: 1, data })) })
    await ruleaza(st, { pasMs: 3000, index: mutant(INDEX, [['poateIncepeZi(accese, plafon, Date.now(), termen)', 'poateIncepeZi(accese, plafon, Date.now(), Infinity)'],
      ['const ms = timpCerere(Date.now(), termen);', 'const ms = timpCerere(Date.now(), Infinity);']]) })
    expect(cereriCond(st).length).toBeGreaterThan(6)
  })
  it('M5 reverificarea lui alaltăieri readusă în planul zilnic: alaltăieri existent se cere din nou', async () => {
    const st = stare({ sites: [santier(1)], rapoarte: [{ site_id: 1, data: '2026-11-11' }], vreme: zileInapoi('2026-11-11', 6).map(z => vremeZi(1, z)) })
    const lg = mutant(LOGICA, [["          if (ex.has(d) || d < PRIMA_ZI_XW", "          if ((ex.has(d) && d !== adunaZile(ieri, -1)) || d < PRIMA_ZI_XW"]])
    await ruleaza(st, { logica: lg })
    expect(st.zilnic.some(x => x.zi === '2026-11-11')).toBe(true)
  })
})
