// BursaTransport (123cargo TMS API v0.82), faza 1: clientul din supabase/functions/_shared/bursaTransport.mjs pe un SERVER SIMULAT local
// (node:http pe 127.0.0.1), fără rețea reală. Serverul simulat urmează specificația (câmpurile obligatorii ale lui load, envelope-ul
// { resultCode, response, availableResults }, codurile 401 / 402 / 409 / 404 / 5xx, cookie-ul Bursa-2step-authentication); valorile
// așteptate sunt scrise de mână din specificație, nu luate din codul testat (L25). Garda de rețea: orice cerere spre altă adresă decât
// serverul simulat pică testul. Date fictive.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { configDinSecrete, clientBursa, construiesteMarfa, dataBursa, locBursa, interpreteazaRaspuns, eroriValidare, listaMarfuri,
  URL_TEST, URL_LIVE, SECRETE_BURSA, COD, TIPURI_CAMION, MAX_PAGINI_CAUTARE, COOKIE_2PASI } from '../../supabase/functions/_shared/bursaTransport.mjs'

const USER = 'gazpet.api.test'
const PAROLA = 'Parolă-de-test-9!'          // fictivă; diacriticele verifică base64 pe UTF-8
const COD_SMS = '123456'
const COOKIE_BUN = 'c2fA9xk_77-zz'
// antetul așteptat, calculat independent (Buffer, nu codul testat)
const BASIC = 'Basic ' + Buffer.from(`${USER}:${PAROLA}`, 'utf8').toString('base64')

// ── serverul simulat ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const S = { mod: 'normal', cere2Pasi: false, cereri: [], marfuri: new Map(), nr: 0, cookieRaspuns: COOKIE_BUN }
const GRUP = { 1: 'A', 2: 'A', 3: 'A', 9: 'A', 10: 'A', 5: 'A', 6: 'B', 8: 'B', 7: 'C', 11: 'D' }   // tabelul truckType din spec
const locValid = p => p && typeof p === 'object' && /^[A-Z]{2}$/.test(p.country || '') && (Number.isInteger(p.id) || (typeof p.name === 'string' && p.name.trim())
  || (typeof p.lat === 'number' && typeof p.lng === 'number'))
function valideazaLoad(l) {
  const e = {}
  if (!l || typeof l !== 'object') return { load: ['body must be a JSON load object'] }
  if (!locValid(l.source)) e.source = ['source city is required']
  if (!locValid(l.destination)) e.destination = ['destination city is required']
  if (typeof l.loadingDate !== 'string' || !/^\d{2}-\d{2}-\d{4}$/.test(l.loadingDate)) e.loadingDate = ['loadingDate must be DD-MM-YYYY']
  if (!Number.isInteger(l.loadingInterval)) e.loadingInterval = ['loadingInterval is required']
  if (!Array.isArray(l.requiredTruck) || !l.requiredTruck.length || l.requiredTruck.some(t => !GRUP[t])) e.requiredTruck = ['requiredTruck is required']
  else if (new Set(l.requiredTruck.map(t => GRUP[t])).size > 1) e.requiredTruck = ['truck types from different groups']
  if (typeof l.weight !== 'number' || !(l.weight > 0)) e.weight = ['weight is required']
  return Object.keys(e).length ? e : null
}
const trimite = (res, status, corp, antete = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...antete }); res.end(corp === undefined ? '' : JSON.stringify(corp)) }

const server = http.createServer((req, res) => {
  let buf = ''
  req.on('data', c => { buf += c })
  req.on('end', () => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let corp = null
    try { corp = buf ? JSON.parse(buf) : null } catch { corp = '__json_invalid__' }
    S.cereri.push({ method: req.method, cale: url.pathname, query: url.search, auth: req.headers.authorization, cookie: req.headers.cookie || null,
      tip: req.headers['content-type'] || null, corp })
    if (url.pathname === '/capcana') return trimite(res, 200, { resultCode: 0, response: { id: 'BM-999999' } })
    if (req.headers.authorization !== BASIC) return trimite(res, 401, { resultCode: 1, response: 'Unauthorized' })
    if (S.mod === '402') return trimite(res, 402, { resultCode: 1, response: 'Payment Required' })
    if (S.mod === '500') return trimite(res, 500, { resultCode: 1, response: 'Internal Server Error' })
    if (S.mod === 'agatat') return   // nu răspunde niciodată (timeout la client)
    if (S.mod === 'redirect') { res.writeHead(302, { Location: '/capcana' }); return res.end() }
    if (S.mod === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>login</html>') }
    if (url.pathname === '/login/login' && req.method === 'POST') {
      if (corp?.code !== COD_SMS) return trimite(res, 200, { resultCode: 1, response: { code: ['Invalid code'] } })
      return trimite(res, 200, { resultCode: 0, response: 'ok' }, { 'Set-Cookie': `${COOKIE_2PASI}=${S.cookieRaspuns}; Path=/; HttpOnly` })
    }
    if (S.cere2Pasi && !(req.headers.cookie || '').split(/;\s*/).includes(`${COOKIE_2PASI}=${COOKIE_BUN}`)) {
      return trimite(res, 409, { resultCode: 1, response: '2step authentication required' })
    }
    const m = /^\/loads(?:\/(BM-[A-Za-z0-9]+))?$/.exec(url.pathname)
    if (m && req.method === 'POST' && !m[1]) {
      const e = valideazaLoad(corp)
      if (e) return trimite(res, 400, { resultCode: 1, response: e })
      const id = 'BM-' + String(++S.nr).padStart(6, '0')
      const load = { ...corp, id, spotlighted: 0 }
      S.marfuri.set(id, load)
      if (S.mod === 'creeaza_apoi_500') return trimite(res, 500, { resultCode: 1, response: 'Internal Server Error' })
      if (S.mod === 'fara_id') return trimite(res, 200, { resultCode: 0, response: { ...load, id: undefined } })
      return trimite(res, 200, { resultCode: 0, response: load })
    }
    if (m && m[1] && req.method === 'PUT') {
      if (!S.marfuri.has(m[1])) return trimite(res, 404, { resultCode: 1, response: 'Not Found' })
      const e = valideazaLoad(corp)
      if (e) return trimite(res, 400, { resultCode: 1, response: e })
      const load = { ...corp, id: m[1] }
      S.marfuri.set(m[1], load)
      return trimite(res, 200, { resultCode: 0, response: load })
    }
    if (m && m[1] && req.method === 'DELETE') {
      if (!S.marfuri.delete(m[1])) return trimite(res, 404, { resultCode: 1, response: 'Not Found' })
      return trimite(res, 200, { resultCode: 0, response: 'Load deleted' })
    }
    if (m && !m[1] && req.method === 'GET') {
      if (S.mod === 'pagina2_500' && Number(url.searchParams.get('offset')) >= 50) return trimite(res, 500, { resultCode: 1, response: 'err' })
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 50), offset = Number(url.searchParams.get('offset') ?? 0)
      const toate = [...S.marfuri.values()]
      const felie = toate.slice(offset, offset + limit)
      // spec: lista e „indexată după load.id” → obiect id → load
      return trimite(res, 200, { resultCode: 0, response: Object.fromEntries(felie.map(x => [x.id, x])), availableResults: toate.length })
    }
    if (url.pathname === '/places' && req.method === 'POST') {
      return trimite(res, 200, { resultCode: 0, response: { id: 4242, name: 'Ploiești', country: 'RO', lat: 44.94, lng: 26.02, postalCode: '100001' } })
    }
    return trimite(res, 404, { resultCode: 1, response: 'Not Found' })
  })
})

let ORIGINE = ''
let cereriStraine = 0
// garda de rețea: DOAR serverul simulat (o adresă reală = test picat, nu cerere trimisă)
const fetchGard = (url, opt) => {
  if (!String(url).startsWith(ORIGINE + '/')) { cereriStraine++; return Promise.reject(new Error('garda: cerere în afara serverului simulat')) }
  return fetch(url, opt)
}
const client = (extra = {}) => clientBursa({ config: { baseUrl: ORIGINE, user: USER, parola: PAROLA }, fetch: fetchGard, ...extra })

beforeAll(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  ORIGINE = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => { server.closeAllConnections?.(); await new Promise(r => server.close(r)) })
beforeEach(() => { S.mod = 'normal'; S.cere2Pasi = false; S.cereri = []; S.marfuri = new Map(); S.nr = 0; S.cookieRaspuns = COOKIE_BUN; cereriStraine = 0 })

// o comandă normalizată completă (fictivă): țevi de 12 m de la depozit la un șantier
const AZI = '2026-11-21'
const comanda = (extra = {}) => ({
  id_comanda: 501, numar_comanda: 'CT-2026-0007',
  plecare: { lat: 44.9419, lng: 26.0225, tara: 'RO' }, destinatie: { localitate: 'Domnești', tara: 'RO' },
  data_incarcare: '2026-11-25', interval_zile: 2, tipuri_camion: [3, 2],
  linii: [
    { denumire: 'Țeavă oțel DN300', cantitate: 10, greutate_kg: 7200, lungime_m: 12, latime_m: 0.33, inaltime_m: 0.33, adr: false, agabaritic: false },
    { denumire: 'Paleți fitinguri', cantitate: 2, greutate_kg: 800, lungime_m: 1.2, latime_m: 0.8, inaltime_m: 1, adr: false, agabaritic: false },
  ],
  descriere: 'Țevi oțel 12 m + 2 paleți, încărcare cu macara la plecare', ...extra,
})

describe('configDinSecrete — numele secretelor, mediul de test implicit, adresele permise', () => {
  const din = o => n => o[n]
  const bune = { BURSATRANSPORT_USER: USER, BURSATRANSPORT_PASSWORD: PAROLA }
  it('numele secretelor sunt exact cele din brief', () => {
    expect(SECRETE_BURSA).toEqual({ user: 'BURSATRANSPORT_USER', parola: 'BURSATRANSPORT_PASSWORD', url: 'BURSATRANSPORT_BASE_URL' })
  })
  it('fără URL = mediul de test din specificație', () => {
    const r = configDinSecrete(din(bune))
    expect(r.ok).toBe(true)
    expect(r.config.baseUrl).toBe('https://test.bursatransport.com/api')
    expect(r.config.mediu).toBe('test')
    expect(URL_TEST).toBe('https://test.bursatransport.com/api')
    expect(URL_LIVE).toBe('https://www.bursatransport.com/api')
  })
  it('URL-ul live e refuzat fără permisiunea explicită din cod; cu ea, acceptat', () => {
    const s = { ...bune, BURSATRANSPORT_BASE_URL: 'https://www.bursatransport.com/api/' }
    expect(configDinSecrete(din(s))).toEqual({ ok: false, cod: COD.LIVE_OPRIT })
    expect(configDinSecrete(din(s), { permiteLive: true }).config.mediu).toBe('live')
  })
  it('orice altă adresă = refuz (secretele nu pleacă spre o adresă oarecare)', () => {
    for (const u of ['http://test.bursatransport.com/api', 'https://test.bursatransport.com.exemplu.ro/api', 'https://test.123cargo.eu/api', 'https://test.bursatransport.com/api/../x']) {
      expect(configDinSecrete(din({ ...bune, BURSATRANSPORT_BASE_URL: u })).cod).toBe(COD.URL_NEPERMIS)
    }
  })
  it('secret lipsă / gol / user cu „:” / caractere de control = neconfigurat, fără valorile în rezultat', () => {
    for (const s of [{}, { BURSATRANSPORT_USER: USER }, { ...bune, BURSATRANSPORT_PASSWORD: '' }, { ...bune, BURSATRANSPORT_USER: 'a:b' },
      { ...bune, BURSATRANSPORT_PASSWORD: 'x' + String.fromCharCode(10) + 'y' }]) {
      const r = configDinSecrete(din(s))
      expect(r).toEqual({ ok: false, cod: COD.NECONFIGURAT })
    }
    expect(configDinSecrete(() => { throw new Error('Deno.env indisponibil') })).toEqual({ ok: false, cod: COD.NECONFIGURAT })
  })
})

describe('construiesteMarfa — maparea comenzii pe load (spec § load: source, destination, loadingDate, loadingInterval, requiredTruck, weight)', () => {
  it('comanda completă → exact obiectul așteptat (scris de mână din spec)', () => {
    const r = construiesteMarfa(comanda(), { azi: AZI })
    expect(r.probleme).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.load).toEqual({
      externalReference: 501,
      source: { lat: 44.9419, lng: 26.0225, country: 'RO' },
      destination: { name: 'Domnești', country: 'RO' },
      loadingDate: '25-11-2026', loadingInterval: 2, requiredTruck: [3, 2],
      weight: 8000,       // 7200 + 800 (greutatea e TOTALĂ pe linie)
      volume: 14.988,     // 12 × 0,33 × 0,33 × 10 = 13,068 + 1,2 × 0,8 × 1 × 2 = 1,92
      length: 12, hazardous: false, temperatureControlled: false,
      description: 'Țevi oțel 12 m + 2 paleți, încărcare cu macara la plecare', privateNotice: 'ERP CT-2026-0007',
    })
    expect(r.avertismente).toEqual([])
  })
  it('fiecare câmp obligatorii lipsă → problema lui, marfa nu se construiește', () => {
    const cazuri = [
      [{ plecare: null }, 'loc_plecare'], [{ destinatie: { tara: 'RO' } }, 'loc_destinatie'], [{ destinatie: { localitate: 'X', tara: 'Romania' } }, 'loc_destinatie'],
      [{ data_incarcare: null }, 'data_incarcare'], [{ data_incarcare: '2026-02-30' }, 'data_incarcare'], [{ data_incarcare: '25.11.2026' }, 'data_incarcare'],
      [{ data_incarcare: '2026-11-20' }, 'data_in_trecut'], [{ interval_zile: null }, 'interval_zile'], [{ interval_zile: 1.5 }, 'interval_zile'], [{ interval_zile: 31 }, 'interval_zile'],
      [{ tipuri_camion: [] }, 'tip_camion'], [{ tipuri_camion: [4] }, 'tip_camion'], [{ tipuri_camion: [3, 6] }, 'tipuri_camion_grupuri_diferite'],
      [{ linii: [] }, 'linii_lipsa'], [{ linii: [{ greutate_kg: 0 }] }, 'greutate_linie'], [{ linii: [{ greutate_kg: NaN }] }, 'greutate_linie'],
      [{ descriere: '   ' }, 'descriere'], [{ descriere: 'x'.repeat(501) }, 'descriere_prea_lunga'], [{ numar_comanda: '' }, 'numar_comanda'],
      [{ pret: { valoare: 1500, moneda: 'GBP', tva: false } }, 'pret'], [{ pret: { valoare: -1, moneda: 'RON', tva: false } }, 'pret'], [{ pret: { valoare: 10, moneda: 'RON' } }, 'pret'],
    ]
    for (const [extra, cod] of cazuri) {
      const r = construiesteMarfa(comanda(extra), { azi: AZI })
      expect({ extra, ok: r.ok, load: r.load, are: r.probleme.includes(cod) }).toEqual({ extra, ok: false, load: null, are: true })
    }
  })
  it('fără ziua curentă (București) de la apelant = problemă, nu presupunere', () => {
    expect(construiesteMarfa(comanda()).probleme).toContain('azi_lipsa')
    expect(construiesteMarfa(comanda(), { azi: '21-11-2026' }).probleme).toContain('azi_lipsa')
    expect(construiesteMarfa(comanda({ data_incarcare: AZI }), { azi: AZI }).ok).toBe(true)   // azi e permis
  })
  it('ADR pe orice linie → hazardous; agabaritic fără tipul 9 → avertisment; prețul și grupajul doar când sunt date', () => {
    const r = construiesteMarfa(comanda({ linii: [{ greutate_kg: 1000, adr: true, agabaritic: true }], pret: { valoare: 2500, moneda: 'RON', tva: true }, grupaj: true }), { azi: AZI })
    expect(r.ok).toBe(true)
    expect(r.load.hazardous).toBe(true)
    expect(r.load.offeredPrice).toEqual({ price: 2500, currency: 'RON', vat: true })
    expect(r.load.groupage).toBe(true)
    expect(r.load.volume).toBeUndefined()                 // dimensiuni lipsă → volumul nu se ghicește
    expect(r.avertismente).toEqual(expect.arrayContaining(['agabaritic_fara_tip_oversized', 'volum_necalculat']))
    expect(construiesteMarfa(comanda({ tipuri_camion: [9], linii: [{ greutate_kg: 1000, agabaritic: true }] }), { azi: AZI }).avertismente).not.toContain('agabaritic_fara_tip_oversized')
  })
  it('volumul se trimite doar dacă TOATE liniile au dimensiuni (o linie fără = fără volum, nu volum parțial)', () => {
    const r = construiesteMarfa(comanda({ linii: [{ greutate_kg: 500, cantitate: 1, lungime_m: 2, latime_m: 1, inaltime_m: 1 }, { greutate_kg: 300 }] }), { azi: AZI })
    expect(r.ok).toBe(true)
    expect(r.load.volume).toBeUndefined()
    expect(r.load.length).toBe(2)
    expect(r.avertismente).toContain('volum_necalculat')
  })
  it('id de comandă ne-întreg (uuid) → fără externalReference (spec: integer), avertisment; marcajul privat rămâne', () => {
    const r = construiesteMarfa(comanda({ id_comanda: '0b7c…' }), { azi: AZI })
    expect(r.ok).toBe(true)
    expect(r.load.externalReference).toBeUndefined()
    expect(r.load.privateNotice).toBe('ERP CT-2026-0007')
    expect(r.avertismente).toContain('fara_referinta_externa')
  })
  it('descrierea publică e curățată de caractere de control', () => {
    const r = construiesteMarfa(comanda({ descriere: 'Linie 1' + String.fromCharCode(10) + 'Linie 2' + String.fromCharCode(0) }), { azi: AZI })
    expect(r.load.description).toBe('Linie 1 Linie 2')
  })
  it('dataBursa / locBursa', () => {
    expect(dataBursa('2026-11-21')).toBe('21-11-2026')
    expect(dataBursa('2028-02-29')).toBe('29-02-2028')
    for (const x of ['2027-02-29', '2026-13-01', '2026-1-01', ' 2026-11-21', null, 20261121]) expect(dataBursa(x)).toBeNull()
    expect(locBursa({ id_bursa: 4242 })).toEqual({ id: 4242, country: 'RO' })
    expect(locBursa({ lat: 0, lng: 0 })).toBeNull()       // (0,0) = coordonate lipsă, nu un loc
    expect(locBursa({ lat: 91, lng: 26 })).toBeNull()
  })
  it('tabelul tipurilor de camion = spec (cod → grup)', () => {
    expect(Object.fromEntries(Object.entries(TIPURI_CAMION).map(([k, v]) => [k, v.grup]))).toEqual({ 1: 'A', 2: 'A', 3: 'A', 9: 'A', 10: 'A', 5: 'A', 6: 'B', 8: 'B', 7: 'C', 11: 'D' })
  })
})

describe('clientul pe serverul simulat — publicare, actualizare, retragere', () => {
  it('publicare: Basic auth corect (UTF-8), JSON, o singură cerere, id BM-…', async () => {
    const c = client()
    const m = construiesteMarfa(comanda(), { azi: AZI })
    const r = await c.publicaMarfa(m.load)
    expect(r).toMatchObject({ ok: true, cod: 'ok', id: 'BM-000001' })
    expect(S.cereri).toHaveLength(1)
    expect(S.cereri[0]).toMatchObject({ method: 'POST', cale: '/loads', auth: BASIC, cookie: null })
    expect(S.cereri[0].tip).toMatch(/^application\/json/)
    expect(S.cereri[0].corp).toEqual(m.load)
    expect(cereriStraine).toBe(0)
  })
  it('validare respinsă de bursă → cod validare cu câmpurile semnalate; fără retry', async () => {
    const r = await client().publicaMarfa({ source: { name: 'Ploiești', country: 'RO' } })
    expect(r.ok).toBe(false)
    expect(r.cod).toBe(COD.VALIDARE)
    expect(r.erori.map(e => e.camp).sort()).toEqual(['destination', 'loadingDate', 'loadingInterval', 'requiredTruck', 'weight'])
    expect(S.cereri).toHaveLength(1)
  })
  it('402 = acces API neactivat; 401 = cont refuzat; ambele o singură cerere', async () => {
    S.mod = '402'
    expect(await client().publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)).toEqual({ ok: false, cod: COD.API_NEACTIVAT, http: 402 })
    S.mod = 'normal'; S.cereri = []
    const gresit = clientBursa({ config: { baseUrl: ORIGINE, user: USER, parola: 'alta' }, fetch: fetchGard })
    expect(await gresit.publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)).toEqual({ ok: false, cod: COD.NEAUTORIZAT, http: 401 })
    expect(S.cereri).toHaveLength(1)
  })
  it('actualizare (PUT /loads/<ID>) și retragere (DELETE); a doua retragere = inexistent', async () => {
    const c = client()
    const m = construiesteMarfa(comanda(), { azi: AZI })
    const p = await c.publicaMarfa(m.load)
    const u = await c.actualizeazaMarfa(p.id, { ...m.load, weight: 9000 })
    expect(u).toMatchObject({ ok: true, id: p.id })
    expect(S.marfuri.get(p.id).weight).toBe(9000)
    expect(S.cereri.at(-1)).toMatchObject({ method: 'PUT', cale: '/loads/' + p.id })
    expect(await c.retrageMarfa(p.id)).toEqual({ ok: true, cod: 'ok', id: p.id })
    expect(S.marfuri.has(p.id)).toBe(false)
    expect(await c.retrageMarfa(p.id)).toEqual({ ok: false, cod: COD.INEXISTENT, http: 404 })
    expect(await c.actualizeazaMarfa(p.id, m.load)).toEqual({ ok: false, cod: COD.INEXISTENT, http: 404 })
  })
  it('id-uri invalide nu pleacă la bursă (fără cale construită din text oarecare)', async () => {
    const c = client()
    for (const id of ['BM-1/../trucks', 'BC-000001', 'BM-', ' BM-000001', 'BM-000001?x=1', 123]) {
      expect(await c.retrageMarfa(id)).toEqual({ ok: false, cod: COD.CERERE })
      expect(await c.actualizeazaMarfa(id, {})).toEqual({ ok: false, cod: COD.CERERE })
    }
    expect(S.cereri).toHaveLength(0)
  })
})

describe('rezultate ambigue (L05): necunoscut, fără retry, reconciliere pe lista mărfurilor', () => {
  it('5xx după ce bursa a creat marfa → necunoscut; căutarea după referință o găsește', async () => {
    S.mod = 'creeaza_apoi_500'
    const c = client()
    const m = construiesteMarfa(comanda(), { azi: AZI })
    const r = await c.publicaMarfa(m.load)
    expect(r.cod).toBe(COD.NECUNOSCUT)
    expect(S.cereri).toHaveLength(1)
    S.mod = 'normal'
    const g = await c.cautaMarfaDupaReferinta({ referinta: 501 })
    expect(g).toMatchObject({ ok: true, complet: true })
    expect(g.gasite.map(x => x.id)).toEqual(['BM-000001'])
    const g2 = await c.cautaMarfaDupaReferinta({ marcaj: m.marcaj })
    expect(g2.gasite.map(x => x.id)).toEqual(['BM-000001'])
  })
  it('timeout → necunoscut (status 0), nu eroare deterministă', async () => {
    S.mod = 'agatat'
    const r = await client({ timeoutMs: 150 }).publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)
    expect(r).toMatchObject({ ok: false, cod: COD.NECUNOSCUT, http: 0 })
  })
  it('200 fără id / pagină HTML → necunoscut la scriere, formă necunoscută la citire', async () => {
    S.mod = 'fara_id'
    expect((await client().publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)).cod).toBe(COD.NECUNOSCUT)
    S.mod = 'html'
    expect((await client().publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)).cod).toBe(COD.NECUNOSCUT)
    expect((await client().paginaMarfuri()).cod).toBe(COD.FORMA)
  })
  it('redirect: NU e urmat (Authorization nu pleacă mai departe) și e necunoscut', async () => {
    S.mod = 'redirect'
    const r = await client().publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load)
    expect(r.cod).toBe(COD.NECUNOSCUT)
    expect(S.cereri.map(x => x.cale)).toEqual(['/loads'])   // /capcana nu a fost cerută
  })
  it('căutarea: pagini până la pagina goală; eroare pe pagina 2 = eroare, nu „negăsit”', async () => {
    const c = client()
    for (let i = 1; i <= 120; i++) await c.publicaMarfa(construiesteMarfa(comanda({ id_comanda: 1000 + i, numar_comanda: 'CT-' + i }), { azi: AZI }).load)
    S.cereri = []
    const g = await c.cautaMarfaDupaReferinta({ referinta: 1117 })
    expect(g.gasite.map(x => x.externalReference)).toEqual([1117])
    expect(g.complet).toBe(true)
    expect(S.cereri.map(x => x.query)).toEqual(['?limit=50&offset=0', '?limit=50&offset=50', '?limit=50&offset=100', '?limit=50&offset=150'])
    S.mod = 'pagina2_500'
    expect(await c.cautaMarfaDupaReferinta({ referinta: 1117 })).toMatchObject({ ok: false, cod: COD.NECUNOSCUT })
  })
  it('marcajul se compară exact: „ERP CT-1” nu găsește „ERP CT-12”', async () => {
    const c = client()
    await c.publicaMarfa(construiesteMarfa(comanda({ id_comanda: 12, numar_comanda: 'CT-12' }), { azi: AZI }).load)
    expect((await c.cautaMarfaDupaReferinta({ marcaj: 'ERP CT-1' })).gasite).toEqual([])
    expect((await c.cautaMarfaDupaReferinta({ referinta: 1 })).gasite).toEqual([])
    expect(await c.cautaMarfaDupaReferinta({})).toEqual({ ok: false, cod: COD.CERERE })
  })
  it('peste plafonul de pagini → complet: false (nu „negăsit”)', async () => {
    for (let i = 1; i <= MAX_PAGINI_CAUTARE * 50 + 1; i++) S.marfuri.set('BM-' + i, { id: 'BM-' + i, externalReference: i })
    const g = await client().cautaMarfaDupaReferinta({ referinta: MAX_PAGINI_CAUTARE * 50 + 1 })
    expect(g).toEqual({ ok: true, cod: 'ok', gasite: [], complet: false })
  })
})

describe('autentificarea în doi pași (409 + cookie Bursa-2step-authentication)', () => {
  it('409 → doi_pasi_necesar; codul SMS → cookie; cererile următoare îl trimit', async () => {
    S.cere2Pasi = true
    const c = client()
    const load = construiesteMarfa(comanda(), { azi: AZI }).load
    expect(await c.publicaMarfa(load)).toEqual({ ok: false, cod: COD.DOI_PASI, http: 409 })
    expect(S.marfuri.size).toBe(0)
    expect(await c.confirma2Pasi('000000')).toMatchObject({ ok: false, cod: COD.VALIDARE })
    expect(c.are2Pasi()).toBe(false)
    const k = await c.confirma2Pasi(COD_SMS)
    expect(k).toEqual({ ok: true, cod: 'ok', cookie: COOKIE_BUN })
    expect(S.cereri.at(-1)).toMatchObject({ method: 'POST', cale: '/login/login', corp: { code: COD_SMS } })
    expect((await c.publicaMarfa(load)).ok).toBe(true)
    expect(S.cereri.at(-1).cookie).toBe(`${COOKIE_2PASI}=${COOKIE_BUN}`)
    // un client nou cu cookie-ul păstrat (faza 2: din stocarea aleasă) nu mai cere codul
    expect((await client({ cookie2Pasi: COOKIE_BUN }).paginaMarfuri()).ok).toBe(true)
  })
  it('cookie cu caractere de antet („;”, spațiu) = respins, nu injectat în cereri', async () => {
    S.cookieRaspuns = 'abc; Domain=exemplu.ro'
    const c = client()
    // Set-Cookie e parsat până la „;” → valoarea „abc” e validă ca formă; verificăm că atributele NU intră în cookie-ul trimis
    const k = await c.confirma2Pasi(COD_SMS)
    expect(k.cookie).toBe('abc')
    await c.paginaMarfuri()
    expect(S.cereri.at(-1).cookie).toBe(`${COOKIE_2PASI}=abc`)
    // valoare primită direct (ex. din stocare) cu caractere interzise = ignorată
    S.cereri = []
    await client({ cookie2Pasi: 'x;y' }).paginaMarfuri()
    expect(S.cereri[0].cookie).toBeNull()
    expect(await c.confirma2Pasi('12 34')).toEqual({ ok: false, cod: COD.CERERE })
  })
})

describe('/places și interpretarea răspunsurilor', () => {
  it('cautaLocalitate: localitatea aleasă de bursă, de arătat omului', async () => {
    const r = await client().cautaLocalitate({ lat: 44.9419, lng: 26.0225, country: 'RO' })
    expect(r).toEqual({ ok: true, cod: 'ok', loc: { id: 4242, name: 'Ploiești', country: 'RO', lat: 44.94, lng: 26.02, postalCode: '100001' } })
  })
  it('codurile HTTP din spec', () => {
    expect(interpreteazaRaspuns(403, null).cod).toBe(COD.INTERZIS)
    expect(interpreteazaRaspuns(409, null).cod).toBe(COD.DOI_PASI)
    expect(interpreteazaRaspuns(502, null, { scriere: true }).cod).toBe(COD.NECUNOSCUT)
    expect(interpreteazaRaspuns(502, null).cod).toBe(COD.NECUNOSCUT)
    expect(interpreteazaRaspuns(200, { resultCode: 0, response: [] })).toMatchObject({ ok: true, date: [] })
    expect(interpreteazaRaspuns(200, { resultCode: 2 }, { scriere: true }).cod).toBe(COD.NECUNOSCUT)
    // 200 + resultCode 1: refuz DOAR cu motive recunoscute; altfel necunoscut la scriere
    expect(interpreteazaRaspuns(200, { resultCode: 1, response: { weight: 'required' } }, { scriere: true })).toMatchObject({ cod: COD.VALIDARE, erori: [{ camp: 'weight', mesaj: 'required' }] })
    expect(interpreteazaRaspuns(200, { resultCode: 1, response: null }, { scriere: true }).cod).toBe(COD.NECUNOSCUT)
  })
  it('erorile de validare: forme diferite, texte tăiate și curățate', () => {
    expect(eroriValidare('Invalid')).toEqual({ erori: [{ camp: null, mesaj: 'Invalid' }], formaCunoscuta: true })
    expect(eroriValidare([{ field: 'weight', message: 'x' }]).erori).toEqual([{ camp: 'weight', mesaj: 'x' }])
    expect(eroriValidare({ a: ['1', '2'] }).erori).toHaveLength(2)
    expect(eroriValidare(42)).toEqual({ erori: [], formaCunoscuta: false })
    expect(eroriValidare('y'.repeat(1000)).erori[0].mesaj).toHaveLength(300)
    expect(listaMarfuri(7)).toBeNull()
  })
})

describe('secretele nu ies din client', () => {
  it('clientul serializat și rezultatele nu conțin parola, antetul Basic sau cookie-ul', async () => {
    S.cere2Pasi = true
    const c = client()
    const tot = []
    tot.push(await c.publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load))
    await c.confirma2Pasi(COD_SMS)
    tot.push(await c.publicaMarfa(construiesteMarfa(comanda(), { azi: AZI }).load))
    tot.push(await c.paginaMarfuri())
    const text = JSON.stringify([c, ...tot])
    for (const s of [PAROLA, BASIC, Buffer.from(`${USER}:${PAROLA}`).toString('base64'), COOKIE_BUN]) expect(text.includes(s)).toBe(false)
    expect(Object.keys(c)).not.toContain('config')
  })
  it('modulul nu scrie nimic în consolă', () => {
    const src = readFileSync('supabase/functions/_shared/bursaTransport.mjs', 'utf8')
    expect(/\bconsole\./.test(src)).toBe(false)
  })
  it('configurație incompletă = excepție la construire, nu client pe jumătate', () => {
    expect(() => clientBursa({ config: { baseUrl: ORIGINE, user: USER }, fetch: fetchGard })).toThrow()
    expect(() => clientBursa({ config: { baseUrl: ORIGINE, user: USER, parola: PAROLA } })).toThrow()
  })
})
