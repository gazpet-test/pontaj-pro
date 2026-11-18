// F1 — butonul unic „Trimite la curier” (docs/redari/FAN_FLUX_OPERATOR_SPEC.md §8.1, §8.3, §8.5, §13 F1): probele vitest cerute de §13.
// Partea de BD (fn_red_fan_comanda, clasa B) e SIMULATĂ aici după contractul migrării 20261228a — semantica SQL reală e probată pe PGlite
// (scripts/pglite/test_redari_fan_operator_local.mjs). Așteptările sunt scrise de mână din spec (L25), nu din codul testat. Date fictive, fără rețea.
// Acoperă: ordinea pașilor la `trimite` (garda pe proiect → RPC-ul comenzii → marcajul recitit → secretele → claim → POST → rezultate → încheierea
// intenției ÎNAINTEA etichetelor, pe TOATE ieșirile buclei), clasa B DOAR prin clientul service_role (deps.rpcServer) și DOAR după comandă,
// `neincercat` DOAR la 429 fără AWB, replay-ul fără POST, tirajul doar pe lotul încheiat (RD031 = fără etichete), mesajele §8.5 ca tabel de cazuri,
// registrul local al intenției (L05 în UI) și ecranul operatorului (butonul dezactivat cu motivul; secțiunile owner-ului).
import { describe, it, expect, vi } from 'vitest'
vi.mock('../lib/supabase.js', () => ({ supabase: {} }))
import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { pregatestePlicuriFan, hashCerereFan, COD_PAUZA_FAN, OBSERVATIE_NEINCERCAT, MAX_PE_CERERE, CODURI_FAN } from '../../supabase/functions/_shared/redariFan.mjs'
import { raspundeFan } from '../../supabase/functions/_shared/redariFanHandler.mjs'
import { executaActiuneFan, MAX_BUCATI_PE_APEL, refuzBd, motivCod } from '../../supabase/functions/_shared/redariFanTransport.mjs'
import { stareTrimitere, textPlafonAzi, plicuriTrimisibile, registruIntentii, intentieLocalaBlocanta, rezultatDovedit, deciziaIntentiei, mesajTrimitere,
  mesajRefuzComanda, mesajEdgeFan, textExclus, textRespins, textRetras, MESAJ_NON_OPERATOR, MESAJ_LOT_NEINCHEIAT, MESAJ_DOAR_TEST_BD, MESAJ_LEGATURA_CURIER,
  MESAJ_DOAR_OPERATOR, ARENDA_INTENTIE_MIN, ETICHETE_STARE_FAN, ETICHETE_MOTIV_ANULARE, MOTIVE_ANULARE, ziRo, PREFIX_REGISTRU_FAN } from './fanLot.js'
import TrimiteLaCurier, { CereriAprobare, SetariZi } from './ui/FanTrimitere.jsx'

const SPEC = readFileSync('docs/redari/FAN_FLUX_OPERATOR_SPEC.md', 'utf8').replace(/\r/g, '')
const MIG = readFileSync('supabase/migrations/20261228a_redari_fan_operator.sql', 'utf8').replace(/\r/g, '')
const LOT = { id: '11111111-2222-4333-8444-555555555555', proiect_id: 'p1', nr_lot: 'PP-0001' }
const UID = 'f0000000-0000-4000-8000-000000000001'
const K = n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const plicId = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const contact = { telefon: '0700 000 001', adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Sat Fictiv', adresa_comuna: 'Comuna Fictivă', adresa_judet: 'Prahova', cod_postal: '100000' }
const nr = i => `PL-TST-${String(i).padStart(4, '0')}`

/** Fixtura: n plicuri active cu toate datele; rândurile FAN pornesc `aprobat` (hash-ul de azi) — comanda simulată le pune în de_trimis. faraTelefon = plicurile (1-based) cu telefonul lipsă. */
async function fixtura(n, { faraTelefon = [], randuri = 'aprobat' } = {}) {
  const plicuri = Array.from({ length: n }, (_, i) => ({ id: plicId(i + 1), nr_plic: nr(i + 1), destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }))
  const convocari = plicuri.map((p, i) => ({ id: `c${i + 1}`, plic_id: p.id, detinator_id: `d${i + 1}` }))
  const contacte = plicuri.map((p, i) => ({ detinator_id: `d${i + 1}`, ...contact, telefon: faraTelefon.includes(i + 1) ? null : contact.telefon }))
  const pr = await pregatestePlicuriFan({ plicuri, convocari, contacte, proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
  const rows = randuri === null ? [] : pr.filter(x => x.ok).map((x, i) => ({ id: `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, plic_id: x.plic.id, nr_plic: x.plic.nr_plic,
    stare: randuri, hash_date: x.hash, awb: null, tarif: null, motiv: null, intentie_cheie: null, cerere_id: null, versiune_urmarire: 1 }))
  return { plicuri, convocari, contacte, pregatite: pr, randuri: rows }
}
const raspunsJson = (status, corp) => ({ status, json: async () => corp, arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(corp)).buffer })
const raspunsPdf = () => ({ status: 200, json: async () => null, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.4\n% fictiv').buffer })
const okPentru = corp => ({ response: corp.shipments.map(s => ({ awbNumber: String(2000000000 + Number(s.info.content.slice(-4))), tariff: 9.5, vat: 1.8, errors: null })) })
let nrCerere = 0
const uuidCerere = () => `99999999-0000-4000-8000-${String(++nrCerere).padStart(12, '0')}`

/**
 * BD-ul simulat după contractul 20261228a (L25: așteptările vin din spec, nu din SQL). `pas` = jurnalul ORDONAT al pașilor (cine / ce), pentru probele de ordine.
 * comanda(ctx) poate înlocui răspunsul comenzii; implicit: toate rândurile `aprobat` ale plicurilor cerute intră în de_trimis (intentie_cheie := cheia), fără aprobări noi.
 * presupunere429 = red_fan_setari.presupunere_429. tiraj = fn_red_fan_tiraj simulat: RD031 cât lotul are rânduri aprobat / in_curs / necunoscut / de_aprobat (§8.8).
 */
function bd(fx, { comanda, presupunere429 = true, fanLotInainte = { lot_id: LOT.id, test: true }, fanLotDupa = { lot_id: LOT.id, test: true }, raspunsPost = (u, init) => raspunsJson(200, okPentru(JSON.parse(init.body))),
  claim, rezultate, incheie, secrete, transportDupa } = {}) {
  const pas = [], apeluri = []
  const intentii = new Map(), tiraj = { cheie: null, nr: 0 }
  const rand = id => fx.randuri.find(r => r.id === id)
  const sumar = cheie => { const ale = fx.randuri.filter(r => r.intentie_cheie === cheie); const c = s => ale.filter(r => s.includes(r.stare)).length
    return { generate: c(['generat', 'ridicat']), respinse: c(['eroare']), retrase: c(['retras']), ramase: c(['aprobat']), necunoscute: c(['in_curs', 'necunoscut']), de_aprobat: c(['de_aprobat']),
      tarif_total: ale.filter(r => ['generat', 'ridicat'].includes(r.stare) && r.tarif != null).reduce((s, r) => s + r.tarif, 0) || null } }
  const rpc = vi.fn(async (nume, args) => {
    pas.push({ cine: 'rpc', nume })
    if (nume === 'fn_red_fan_comanda') {
      if (comanda) return comanda({ args, fx, intentii })
      const ids = fx.randuri.filter(r => r.stare === 'aprobat' && args.p_plicuri.some(p => p.plic_id === r.plic_id)).map(r => r.id)
      for (const id of ids) rand(id).intentie_cheie = args.p_intentie
      intentii.set(args.p_intentie, { stare: 'in_curs' })
      return { data: { intentie: args.p_intentie, mod: 'noua', replay: false, incheiata: false, aprobate: [], numarate: 0, de_trimis: ids, preluate: ids.length, de_aprobat: 0, cerere_id: null, excluse: [], retrase: [],
        azi: { limita: 20, aprobate_inainte: 0, incapeau: 20 } } }
    }
    if (nume === 'fn_red_fan_tiraj') {
      if (fx.randuri.some(r => r.lot !== 'altul' && ['aprobat', 'in_curs', 'necunoscut', 'de_aprobat'].includes(r.stare))) return { error: { code: 'RD031', message: 'redari fan: lotul nu e incheiat' } }
      if (tiraj.cheie == null) Object.assign(tiraj, { cheie: args.p_cheie, nr: 1, la: '2026-11-18T10:00:00+00:00' })
      if (tiraj.cheie !== args.p_cheie) return { error: { code: 'RD020', message: 'tirajul s-a schimbat' } }
      return { data: { stare: tiraj.nr === 1 && !tiraj.vazut ? (tiraj.vazut = true, 'inceput') : 'acelasi', cheie: tiraj.cheie, nr: tiraj.nr, inceput_la: tiraj.la, oprit_la: null } }
    }
    return { error: { code: '42883', message: `RPC neașteptat cu JWT: ${nume}` } }
  })
  const rpcServer = vi.fn(async (nume, args) => {
    pas.push({ cine: 'rpcServer', nume })
    if (!nume.startsWith('fn_red_fan_srv_')) return { error: { code: '42883', message: `clasa B cere fn_red_fan_srv_*: ${nume}` } }
    if (nume === 'fn_red_fan_srv_claim') {
      if (claim) return claim(args)
      const cerere = uuidCerere()
      for (const id of args.p_ids) { const r = rand(id); if (r.stare !== 'aprobat') return { error: { code: 'P0001', message: 'rand schimbat' } }; r.stare = 'in_curs'; r.cerere_id = cerere }
      return { data: { cerere_id: cerere, retrase: [] } }
    }
    if (nume === 'fn_red_fan_srv_rezultate') {
      if (rezultate) return rezultate(args)
      const neinc = args.p_rezultate.filter(x => x.stare === OBSERVATIE_NEINCERCAT).length
      if (neinc && (neinc !== args.p_rezultate.length || args.p_http !== 429)) return { error: { code: '22023', message: 'neincercat doar la 429, pe toata solicitarea' } }
      for (const x of args.p_rezultate) { const r = rand(x.id); if (r.cerere_id !== args.p_cerere || r.stare !== 'in_curs') return { error: { code: 'P0001', message: 'CAS' } }
        if (x.stare === OBSERVATIE_NEINCERCAT) { r.stare = presupunere429 ? 'aprobat' : 'necunoscut'; if (presupunere429) r.cerere_id = null }
        else { r.stare = x.stare; r.awb = x.awb; r.tarif = x.tarif; r.motiv = x.motiv } }
      return { data: args.p_rezultate.length }
    }
    if (nume === 'fn_red_fan_srv_intentie_incheie') {
      if (incheie) return incheie(args)
      const s = sumar(args.p_cheie)
      if (s.necunoscute > 0) return { data: { incheiata: false, necunoscute: s.necunoscute } }
      intentii.set(args.p_cheie, { stare: 'incheiata' })
      return { data: { incheiata: true, rezultat: { ...s, ...args.p_rezultat } } }
    }
    return { data: null }
  })
  const fetch = vi.fn(async (url, init) => {
    const u = new URL(url)
    apeluri.push({ metoda: init.method, cale: u.pathname })
    if (u.pathname === '/login') return raspunsJson(200, { status: 'success', data: { token: 'tok', expiresAt: '2026-11-18 10:00' } })
    if (u.pathname === '/intern-awb') { pas.push({ cine: 'fan', nume: 'POST /intern-awb' }); return raspunsPost(u, init) }
    if (u.pathname === '/awb/label') { pas.push({ cine: 'fan', nume: 'GET /awb/label' }); return raspunsPdf() }
    throw new Error('cale FAN neașteptată: ' + u.pathname)
  })
  let fanLotApel = 0
  const deps = {
    getUser: async () => ({ data: { user: { id: UID } } }), owner: async () => ({ data: false }), operator: async () => ({ data: true }),
    lot: async () => ({ data: LOT }), proiect: async () => ({ data: { id: 'p1', cod: 'TEST-RAZVAN' } }),
    fanLot: vi.fn(async () => { pas.push({ cine: 'bd', nume: 'fanLot' }); return { data: fanLotApel++ === 0 ? fanLotInainte : fanLotDupa } }),
    transportPermisDupaRpc: vi.fn(transportDupa || (({ proiectCod, fanLot }) => { pas.push({ cine: 'handler', nume: 'transportPermis(cereMarcaj:true)' }); return proiectCod === 'TEST-RAZVAN' && fanLot?.test === true ? { ok: true } : { ok: false, cod: 'transport_real_doar_test', motiv: 'lot nemarcat' } })),
    secrete: vi.fn(secrete || (() => { pas.push({ cine: 'edge', nume: 'secrete' }); return { username: 'u', password: 'p', clientId: 'C' } })),
    datePlicuri: async () => ({ data: { plicuri: fx.plicuri, convocari: fx.convocari, contacte: fx.contacte } }),
    randuriLot: async () => ({ data: fx.randuri.map(r => ({ ...r })) }),
    plicuriLot: async () => ({ data: fx.plicuri }),
    rpc, rpcServer, fetch, pauza: vi.fn(async () => {}), subtle: webcrypto.subtle,
  }
  return { deps, pas, apeluri, intentii, rpc, rpcServer, fetch, sumar }
}
const trimite = (fx, o, corp = {}) => { const b = bd(fx, o); const p = executaActiuneFan({ corp: { actiune: 'trimite', lot_id: LOT.id, plic_ids: fx.plicuri.map(x => x.id), intentie: K(1), ...corp }, lot: LOT, uid: UID, proiectCod: 'TEST-RAZVAN' }, b.deps); return { ...b, p } }
const numePasi = pas => pas.map(x => x.nume)
const DOAR_B = ['fn_red_fan_srv_claim', 'fn_red_fan_srv_rezultate', 'fn_red_fan_srv_intentie_incheie', 'fn_red_fan_srv_reconciliaza', 'fn_red_fan_srv_anuleaza', 'fn_red_fan_srv_urmarire', 'fn_red_fan_srv_confirmari']
/** Clasa B DOAR prin rpcServer și DOAR după comandă; comenzile (clasa A) DOAR prin rpc (JWT-ul omului) — pe orice traseu. */
function claseRespectate({ rpc, rpcServer, pas }) {
  for (const [n] of rpc.mock.calls) if (DOAR_B.includes(n) || n.startsWith('fn_red_fan_srv_')) return `clasa B chemată cu JWT-ul omului: ${n}`
  for (const [n] of rpcServer.mock.calls) if (!n.startsWith('fn_red_fan_srv_')) return `rpcServer chemat pentru o comandă: ${n}`
  const iCmd = pas.findIndex(x => x.nume === 'fn_red_fan_comanda'), iB = pas.findIndex(x => x.cine === 'rpcServer')
  if (iB >= 0 && (iCmd < 0 || iB < iCmd)) return 'clasa B chemată înaintea comenzii'
  return null
}

describe('F1 — `trimite`: ordinea pașilor (spec §8.1) și clasele RPC (§7.3)', () => {
  it('(d) traseul normal: comandă → marcajul recitit (cereMarcaj:true) → secretele → claim → POST → rezultate → ÎNCHEIEREA intenției → tirajul → etichetele, în același răspuns', async () => {
    const fx = await fixtura(3)
    const t = trimite(fx)
    const r = await t.p
    expect(r.status).toBe(200)
    expect(numePasi(t.pas)).toEqual(['fn_red_fan_comanda', 'fanLot', 'transportPermis(cereMarcaj:true)', 'secrete', 'fn_red_fan_srv_claim', 'POST /intern-awb', 'fn_red_fan_srv_rezultate',
      'fn_red_fan_srv_intentie_incheie', 'fn_red_fan_tiraj', 'secrete', 'GET /awb/label', 'fn_red_fan_tiraj'])
    expect(r.body).toMatchObject({ cod: 'ok', incheiata: true, generate: 3, necunoscute: 0, ramase: 0, oprit: null, nimic_de_trimis: false, replay: false, mod: 'noua' })
    expect(r.body.pdf_parti).toHaveLength(1); expect(r.body.tiraj).toMatchObject({ nr: 1, cheie: expect.stringMatching(/^[0-9a-f]{64}$/) }); expect(r.body.manifest_cheie).toBeTruthy()
    expect(r.body.tarif_total).toBe(28.5)
    expect(claseRespectate(t)).toBeNull()
    // p_actor = omul din JWT, p_intentie = cheia; claim-ul ÎNAINTEA POST-ului (L22); încheierea ÎNAINTEA etichetelor
    expect(t.rpcServer.mock.calls.map(c => [c[0], c[1].p_actor, c[1].p_intentie ?? c[1].p_cheie])).toEqual([['fn_red_fan_srv_claim', UID, K(1)], ['fn_red_fan_srv_rezultate', UID, K(1)], ['fn_red_fan_srv_intentie_incheie', UID, K(1)]])
    expect(t.rpcServer.mock.calls[1][1]).toMatchObject({ p_http: 200, p_cerere: expect.stringMatching(/^99999999-/) })
    expect(t.rpcServer.mock.calls[2][1].p_rezultat).toEqual({ oprit: false, excluse: [], retrase: [] })
    expect(t.intentii.get(K(1))).toEqual({ stare: 'incheiata' })
    expect(fx.randuri.map(x => x.stare)).toEqual(['generat', 'generat', 'generat'])
  })
  it('lotul NEMARCAT (a): prin raspundeFan garda pe proiect trece cu cereMarcaj:false (marcajul lipsește), RPC-ul îl pune, recitirea îl găsește, AWB-urile se generează', async () => {
    const fx = await fixtura(2)
    const b = bd(fx, { fanLotInainte: null, fanLotDupa: { lot_id: LOT.id, test: true } })
    const r = await raspundeFan({ jwt: 'x', corp: { actiune: 'trimite', lot_id: LOT.id, plic_ids: fx.plicuri.map(x => x.id), intentie: K(1) } }, b.deps)
    expect([r.status, r.body.cod, r.body.generate]).toEqual([200, 'ok', 2])
    expect(numePasi(b.pas).slice(0, 5)).toEqual(['fanLot', 'fn_red_fan_comanda', 'fanLot', 'transportPermis(cereMarcaj:true)', 'secrete'])
    expect(b.deps.fanLot).toHaveBeenCalledTimes(2)
    // (c) marcajul nu apare nici după RPC (defect): oprire la pasul 4 cu 423, secretele necitite, nimic plătit
    const fx2 = await fixtura(2)
    const b2 = bd(fx2, { fanLotInainte: null, fanLotDupa: null })
    const r2 = await raspundeFan({ jwt: 'x', corp: { actiune: 'trimite', lot_id: LOT.id, plic_ids: fx2.plicuri.map(x => x.id), intentie: K(1) } }, b2.deps)
    expect([r2.status, r2.body.cod]).toEqual([423, 'transport_real_doar_test'])
    expect(b2.deps.secrete).not.toHaveBeenCalled(); expect(b2.rpcServer).not.toHaveBeenCalled(); expect(b2.fetch).not.toHaveBeenCalled()
  })
  it('(b)/(c) RD032 din BD (proiect ne-TEST sau lot marcat REAL de owner) → 423 transport_real_doar_test, înaintea secretelor; 42501 → 403; RD03x → 409 cu codul BD; 5xx → 503', async () => {
    const fx = await fixtura(1)
    const t = trimite(fx, { comanda: () => ({ error: { code: 'RD032', message: 'redari fan: doar proiecte de TEST' } }) })
    const r = await t.p
    expect(r).toEqual({ status: 423, body: { cod: 'transport_real_doar_test', cod_bd: 'RD032' } })
    expect(t.deps.secrete).not.toHaveBeenCalled(); expect(t.rpcServer).not.toHaveBeenCalled(); expect(t.fetch).not.toHaveBeenCalled()
    expect(refuzBd({ code: '42501' })).toMatchObject({ status: 403, body: { cod: 'non_operator' } })
    for (const c of Object.keys(CODURI_FAN).filter(c => c !== 'RD032')) expect(refuzBd({ code: c, message: 'm' })).toMatchObject({ status: 409, body: { cod: 'comanda_refuzata', cod_bd: c, motiv: CODURI_FAN[c] } })
    for (const c of ['22023', 'P0001', 'P0002', '23505']) expect(refuzBd({ code: c })).toMatchObject({ status: 409, body: { cod_bd: c } })
    expect(refuzBd({ code: 'XX000' })).toMatchObject({ status: 503 }); expect(refuzBd(undefined, 'comanda_neconfirmata')).toEqual({ status: 503, body: { cod: 'comanda_neconfirmata', cod_bd: null } })
    expect(refuzBd({ code: 'RD032' }).body).not.toHaveProperty('mesaj')   // fără textul BD la 423 (același mesaj ca garda din handler)
  })
  it('429 FĂRĂ niciun AWB → observația `neincercat` pe TOATĂ solicitarea cu p_http = 429; P429 în picioare: rândurile revin aprobat, intenția încheiată cu ramase, FĂRĂ tiraj (generate 0)', async () => {
    const fx = await fixtura(3)
    const t = trimite(fx, { raspunsPost: () => raspunsJson(COD_PAUZA_FAN, null) })
    const r = await t.p
    const rez = t.rpcServer.mock.calls.find(c => c[0] === 'fn_red_fan_srv_rezultate')[1]
    expect(rez.p_http).toBe(429); expect(rez.p_rezultate.map(x => x.stare)).toEqual([OBSERVATIE_NEINCERCAT, OBSERVATIE_NEINCERCAT, OBSERVATIE_NEINCERCAT]); expect(rez.p_rezultate.every(x => x.awb === null)).toBe(true)
    expect(r.body).toMatchObject({ cod: 'ok', incheiata: true, generate: 0, ramase: 3, oprit: '429', necunoscute: 0, tiraj: null, pdf_parti: [] })
    expect(numePasi(t.pas)).toEqual(['fn_red_fan_comanda', 'fanLot', 'transportPermis(cereMarcaj:true)', 'secrete', 'fn_red_fan_srv_claim', 'POST /intern-awb', 'fn_red_fan_srv_rezultate', 'fn_red_fan_srv_intentie_incheie'])
    expect(t.rpcServer.mock.calls.at(-1)[1].p_rezultat).toMatchObject({ oprit: true, motiv_oprire: '429' })
    expect(fx.randuri.map(x => x.stare)).toEqual(['aprobat', 'aprobat', 'aprobat'])
    expect(mesajTrimitere(r.body)).toMatch(/Curierul a cerut o pauză; restul \(3 plicuri\) se trimite mai târziu/)
    // P429 contrazisă (red_fan_setari.presupunere_429 = false): aceeași observație → necunoscut în BD, încheierea refuzată, fără tiraj, mesajul „NU retrimite”
    const fx2 = await fixtura(2)
    const t2 = trimite(fx2, { raspunsPost: () => raspunsJson(COD_PAUZA_FAN, null), presupunere429: false })
    const r2 = await t2.p
    expect(fx2.randuri.map(x => x.stare)).toEqual(['necunoscut', 'necunoscut'])
    expect(r2.body).toMatchObject({ cod: 'ok', incheiata: false, necunoscute: 2, generate: 0, tiraj: null })
    expect(t2.rpc.mock.calls.map(c => c[0])).toEqual(['fn_red_fan_comanda'])   // fără fn_red_fan_tiraj
    expect(mesajTrimitere(r2.body)).toMatch(/Răspunsul curierului nu s-a confirmat pentru 2 plicuri\. NU retrimite\./)
  })
  it('429 CU număr AWB în răspuns → `necunoscut` (nu neincercat), p_http = 429, bucla se oprește, încheierea refuzată, fără tiraj', async () => {
    const fx = await fixtura(2)
    const t = trimite(fx, { raspunsPost: () => raspunsJson(COD_PAUZA_FAN, { response: [{ awbNumber: '2000000001' }, { awbNumber: null }] }) })
    const r = await t.p
    const rez = t.rpcServer.mock.calls.find(c => c[0] === 'fn_red_fan_srv_rezultate')[1]
    expect(rez.p_http).toBe(429); expect(rez.p_rezultate.map(x => x.stare)).toEqual(['necunoscut', 'necunoscut'])
    expect(r.body).toMatchObject({ incheiata: false, oprit: 'necunoscut', necunoscute: 2 })
    expect(t.rpc.mock.calls.map(c => c[0])).toEqual(['fn_red_fan_comanda'])
  })
  it(`limita de ${MAX_BUCATI_PE_APEL} solicitări: încheierea e chemată O dată, după buclă; tirajul e cerut (generate ≥ 1) dar BD-ul dă RD031 (rămân aprobat) → fără etichete, „se tipăresc după”`, async () => {
    const fx = await fixtura(MAX_PE_CERERE * MAX_BUCATI_PE_APEL + 7)
    const t = trimite(fx)
    const r = await t.p
    const b = t.rpcServer.mock.calls.map(c => c[0])
    expect(b.filter(x => x === 'fn_red_fan_srv_claim')).toHaveLength(MAX_BUCATI_PE_APEL); expect(t.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(MAX_BUCATI_PE_APEL)
    expect(b.filter(x => x === 'fn_red_fan_srv_intentie_incheie')).toHaveLength(1); expect(b.at(-1)).toBe('fn_red_fan_srv_intentie_incheie')
    expect(t.pas.findIndex(x => x.nume === 'fn_red_fan_srv_intentie_incheie')).toBeLessThan(t.pas.findIndex(x => x.nume === 'fn_red_fan_tiraj'))
    expect(r.body).toMatchObject({ incheiata: true, generate: MAX_PE_CERERE * MAX_BUCATI_PE_APEL, ramase: 7, oprit: 'limita_solicitari', etichete_eroare: 'lot_neincheiat', pdf_parti: [], tiraj: null })
    expect(t.apeluri.some(a => a.cale === '/awb/label')).toBe(false)
    expect(t.rpcServer.mock.calls.at(-1)[1].p_rezultat.motiv_oprire).toBe('limita_solicitari')
    expect(mesajTrimitere(r.body)).toMatch(/S-au trimis 500; mai sunt 7/); expect(mesajTrimitere(r.body)).toMatch(new RegExp(MESAJ_LOT_NEINCHEIAT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    expect(claseRespectate(t)).toBeNull()
  })
  it('răspuns necunoscut (timeout / 5xx) → oprire, încheierea chemată și REFUZATĂ (rânduri in_curs / necunoscut), fără tiraj, fără al doilea POST; mesajul „NU retrimite”', async () => {
    for (const rasp of [() => raspunsJson(0, null), () => raspunsJson(503, null)]) {
      const fx = await fixtura(MAX_PE_CERERE + 1)
      const t = trimite(fx, { raspunsPost: rasp })
      const r = await t.p
      expect(t.apeluri.filter(a => a.cale === '/intern-awb')).toHaveLength(1)
      expect(numePasi(t.pas).slice(-3)).toEqual(['POST /intern-awb', 'fn_red_fan_srv_rezultate', 'fn_red_fan_srv_intentie_incheie'])
      expect(r.body).toMatchObject({ cod: 'ok', incheiata: false, oprit: 'necunoscut', necunoscute: MAX_PE_CERERE, ramase: 1, tiraj: null })
      expect(mesajTrimitere(r.body)).toMatch(/NU retrimite/)
    }
  })
  it('scrierea rezultatelor NECONFIRMATĂ (5xx la clasa B) → oprire, încheierea tot chemată (refuzată: rândurile rămân in_curs), fără tiraj; nimic nu se regenerează (L05)', async () => {
    const fx = await fixtura(2)
    const t = trimite(fx, { rezultate: () => ({ error: { code: 'XX000', message: 'conexiune pierduta' } }) })
    const r = await t.p
    expect(numePasi(t.pas).slice(-2)).toEqual(['fn_red_fan_srv_rezultate', 'fn_red_fan_srv_intentie_incheie'])
    expect(t.rpcServer.mock.calls.at(-1)[1].p_rezultat).toMatchObject({ oprit: true, motiv_oprire: 'scriere_neconfirmata' })
    expect(r.body).toMatchObject({ incheiata: false, oprit: 'scriere_neconfirmata', necunoscute: 2, tiraj: null })
    expect(fx.randuri.map(x => x.stare)).toEqual(['in_curs', 'in_curs'])
    expect(mesajTrimitere(r.body)).toMatch(/NU retrimite/)
  })
  it('rezervarea refuzată (claim-ul a găsit un rând schimbat) → NICIUN POST, încheierea chemată (rândurile rămân aprobat → încheiată cu ramase), fără tiraj', async () => {
    const fx = await fixtura(2)
    const t = trimite(fx, { claim: () => ({ error: { code: 'P0001', message: 'redari fan: rand schimbat intre aprobare si rezervare' } }) })
    const r = await t.p
    expect(t.apeluri.some(a => a.cale === '/intern-awb')).toBe(false)
    expect(numePasi(t.pas).slice(-2)).toEqual(['fn_red_fan_srv_claim', 'fn_red_fan_srv_intentie_incheie'])
    expect(r.body).toMatchObject({ incheiata: true, oprit: 'rezervare_refuzata', generate: 0, ramase: 2, tiraj: null })
    expect(mesajTrimitere(r.body)).toMatch(/Datele unui plic s-au schimbat între timp; nimic trimis pentru acea bucată/)
  })
  it('încheierea intenției NECONFIRMATĂ (5xx) după rezultate scrise → răspuns ok cu incheiere_neconfirmata, fără tiraj / etichete; rândurile generat rămân', async () => {
    const fx = await fixtura(2)
    const t = trimite(fx, { incheie: () => ({ error: { code: 'XX000', message: 'x' } }) })
    const r = await t.p
    expect(r.body).toMatchObject({ cod: 'ok', incheiata: false, incheiere_neconfirmata: true, generate: 2, tiraj: null, pdf_parti: [] })
    expect(t.rpc.mock.calls.map(c => c[0])).toEqual(['fn_red_fan_comanda'])
    expect(fx.randuri.map(x => x.stare)).toEqual(['generat', 'generat'])
  })
  it('REPLAY (intenția deja încheiată): zero claim, zero POST, zero încheiere; etichetele se cer DOAR dacă sumarul memorat are generate ≥ 1 (recuperarea fără regenerare)', async () => {
    const fx = await fixtura(2)
    for (const r of fx.randuri) { r.stare = 'generat'; r.awb = '200000000' + r.nr_plic.slice(-1); r.intentie_cheie = K(1); r.tarif = 9.5 }
    const t = trimite(fx, { comanda: () => ({ data: { intentie: K(1), replay: true, mod: 'replay', stare: 'incheiata', incheiata: true, rezultat: { generate: 2, respinse: 0, ramase: 0, tarif_total: 19 }, incheiata_la: '2026-11-18T10:00:00Z' } }) })
    const r = await t.p
    expect(t.rpcServer).not.toHaveBeenCalled(); expect(t.apeluri.some(a => a.cale === '/intern-awb')).toBe(false); expect(t.deps.secrete).toHaveBeenCalledTimes(1)   // doar pentru etichete
    expect(numePasi(t.pas)).toEqual(['fn_red_fan_comanda', 'fn_red_fan_tiraj', 'secrete', 'GET /awb/label', 'fn_red_fan_tiraj'])
    expect(r.body).toMatchObject({ cod: 'ok', replay: true, incheiata: true, generate: 2, tiraj: { nr: 1 } }); expect(r.body.pdf_parti).toHaveLength(1)
    expect(mesajTrimitere({ ...r.body, incheiata_la: '2026-11-18T10:00:00Z' })).toMatch(/Rezultat deja înregistrat la 12:00 \(aceeași apăsare\): nimic retrimis/)
    // replay cu generate 0 (toate respinse): nimic cerut la curier, niciun tiraj
    const fx2 = await fixtura(1); fx2.randuri[0].stare = 'eroare'; fx2.randuri[0].intentie_cheie = K(2); fx2.randuri[0].motiv = 'phone invalid'
    const t2 = trimite(fx2, { comanda: () => ({ data: { intentie: K(2), replay: true, mod: 'replay', stare: 'incheiata', incheiata: true, rezultat: { generate: 0, respinse: 1 } } }) }, { intentie: K(2) })
    const r2 = await t2.p
    expect(t2.rpc.mock.calls.map(c => c[0])).toEqual(['fn_red_fan_comanda']); expect(t2.fetch).not.toHaveBeenCalled()
    expect(r2.body).toMatchObject({ replay: true, generate: 0, respinse: [{ nr_plic: nr(1), motiv_cod: 'phone' }] })
  })
  it('încheiată de RPC (peste plafon: toate de_aprobat) → fără marcaj recitit, fără secrete, fără POST; răspunsul spune de_aprobat = n; mesajul „așteaptă aprobarea” cu „azi mai încăpeau X”', async () => {
    const fx = await fixtura(3, { randuri: null })
    const t = trimite(fx, { comanda: ({ args }) => ({ data: { intentie: args.p_intentie, mod: 'noua', replay: false, incheiata: true, aprobate: [], numarate: 0, de_trimis: [], preluate: 0, de_aprobat: 3, cerere_id: K(9),
      excluse: [], retrase: [], rezultat: { generate: 0, de_aprobat: 3, mod: 'noua', nimic_de_trimis: false }, azi: { limita: 20, aprobate_inainte: 19, incapeau: 1 } } }) })
    const r = await t.p
    expect(numePasi(t.pas)).toEqual(['fn_red_fan_comanda'])
    expect(r.body).toMatchObject({ cod: 'ok', incheiata: true, generate: 0, de_aprobat: 3, cerere_id: K(9), nimic_de_trimis: false, tiraj: null })
    expect(mesajTrimitere(r.body)).toBe('Toate cele 3 plicuri așteaptă aprobarea proprietarului (azi mai încăpeau 1). După aprobare, apasă din nou „Trimite la curier”.')
    // „nimic de trimis” (lot complet / toate excluse) → mesajul §8.5 + motivele; fără apel la curier
    const t2 = trimite(fx, { comanda: ({ args }) => ({ data: { intentie: args.p_intentie, mod: 'noua', replay: false, incheiata: true, aprobate: [], numarate: 0, de_trimis: [], preluate: 0, de_aprobat: 0, cerere_id: null,
      excluse: [{ nr_plic: nr(1), motiv_cod: 'are_deja_expediere' }, { nr_plic: nr(2), motiv_cod: 'lot_tiparit' }, { nr_plic: nr(3), motiv_cod: 'in_asteptare_aprobare' }], retrase: [{ nr_plic: nr(2), motiv_cod: 'lot_tiparit' }],
      rezultat: { generate: 0, nimic_de_trimis: true }, azi: { limita: 20, aprobate_inainte: 0, incapeau: 20 } } }) })
    const r2 = await t2.p
    expect(r2.body).toMatchObject({ incheiata: true, generate: 0, nimic_de_trimis: true }); expect(t2.fetch).not.toHaveBeenCalled()
    const m = mesajTrimitere(r2.body)
    expect(m.split('\n')[0]).toBe('Nimic de trimis: plicurile alese au deja AWB sau sunt excluse (motivele mai jos).')
    expect(m).toMatch(/PL-TST-0002 — lotul e deja tipărit; plicul nu mai intră în el/); expect(m).toMatch(/PL-TST-0003 — așteaptă decizia proprietarului/); expect(m).toMatch(/PL-TST-0002 — scos din trimitere: lotul e tipărit/)
  })
  it('răspunsul comenzii fără de_trimis și neîncheiat (formă neașteptată) → 503 comanda_neconfirmata, nimic plătit; corp invalid → 400 fără citiri', async () => {
    const fx = await fixtura(1)
    const t = trimite(fx, { comanda: ({ args }) => ({ data: { intentie: args.p_intentie, mod: 'noua', replay: false, incheiata: false, de_trimis: [] } }) })
    expect((await t.p).body.cod).toBe('comanda_neconfirmata'); expect(t.deps.secrete).not.toHaveBeenCalled()
    expect((await trimite(fx, {}, { replay: 'x', intentie: K(1), plic_ids: [] }).p).status).toBe(400)
    for (const corp of [{ plic_ids: ['x'] }, { plic_ids: [plicId(1), plicId(1)] }, { intentie: 'nu-e-uuid' }, { plic_ids: Array.from({ length: 2001 }, (_, i) => plicId(i + 1)) }]) {
      const t2 = trimite(fx, {}, corp)
      expect((await t2.p).status).toBe(400); expect(t2.rpc).not.toHaveBeenCalled()
    }
    // fără uid (identitatea lipsește) → 400, nimic chemat
    const b = bd(fx)
    expect((await executaActiuneFan({ corp: { actiune: 'trimite', lot_id: LOT.id, plic_ids: [plicId(1)], intentie: K(1) }, lot: LOT, uid: null, proiectCod: 'TEST-RAZVAN' }, b.deps)).status).toBe(400)
    expect(b.rpc).not.toHaveBeenCalled()
  })
  it('plicurile fără datele cerute de curier sunt excluse LOCAL (date_incomplete, cu detaliile) și nu ajung la RPC; niciun plic bun → răspuns „nimic de trimis” fără RPC', async () => {
    const fx = await fixtura(3, { faraTelefon: [2] })
    const t = trimite(fx)
    const r = await t.p
    expect(t.rpc.mock.calls[0][1].p_plicuri.map(p => p.plic_id)).toEqual([plicId(1), plicId(3)])
    expect(r.body.excluse).toEqual([{ nr_plic: nr(2), motiv_cod: 'date_incomplete', detalii: expect.arrayContaining([expect.stringMatching(/telefon/i)]) }])
    expect(r.body.generate).toBe(2)
    expect(mesajTrimitere(r.body)).toMatch(/PL-TST-0002 — lipsesc date cerute de curier \(fișa deținătorului\): .*telefon/i)
    const fx2 = await fixtura(1, { faraTelefon: [1] })
    const t2 = trimite(fx2)
    const r2 = await t2.p
    expect(r2.body).toMatchObject({ cod: 'ok', incheiata: true, nimic_de_trimis: true, generate: 0, mod: 'nimic' }); expect(t2.rpc).not.toHaveBeenCalled()
    expect(rezultatDovedit(r2.body)).toBe(true)   // nimic scris în BD, cheia iese din registru
  })
  it('respingerea de curier pe un element: motivul = codul câmpului (phone / adresa / name / necunoscut), fără textul curierului; mesajul §8.5 pe fiecare plic + sfatul „lot nou”', async () => {
    const fx = await fixtura(3)
    const t = trimite(fx, { raspunsPost: (u, init) => { const c = okPentru(JSON.parse(init.body)); c.response[1] = { awbNumber: null, errors: { phone: ['Telefonul 0700000001 e invalid'] } }; return raspunsJson(200, c) } })
    const r = await t.p
    expect(r.body.generate).toBe(2); expect(r.body.respinse).toEqual([{ nr_plic: nr(2), motiv_cod: 'phone' }])
    expect(JSON.stringify(r.body)).not.toMatch(/0700000001/)
    const m = mesajTrimitere(r.body)
    expect(m).toMatch(/^2 AWB-uri generate, 1 respins\. Tarif: 19,00 lei fără TVA\./); expect(m).toMatch(/PL-TST-0002 — telefonul lipsește sau e greșit/); expect(m).toMatch(/mută-le într-un lot nou de plicuire/)
    expect([motivCod('county invalid'), motivCod('street x'), motivCod('zipCode'), motivCod('name too long'), motivCod('phone'), motivCod('altceva'), motivCod(null)]).toEqual(['adresa', 'adresa', 'adresa', 'name', 'phone', 'necunoscut', 'necunoscut'])
    // tirajul: lotul e încheiat prin rânduri (generat + eroare) → etichetele doar pentru cele 2 generate
    expect(r.body.tiraj).toMatchObject({ nr: 1 }); expect(r.body.pozitii.map(p => p.nr_plic)).toEqual([nr(1), nr(3)]); expect(r.body.ramase_netiparite).toEqual([nr(2)])
  })
  it('etichetele pică (502 / HTML) DUPĂ AWB-uri generate: intenția e încheiată, răspunsul spune că AWB-urile există; recuperarea = `eticheta` / replay, fără POST nou', async () => {
    const fx = await fixtura(2)
    const b = bd(fx)
    b.deps.fetch = vi.fn(async (url, init) => { const u = new URL(url); if (u.pathname === '/login') return raspunsJson(200, { status: 'success', data: { token: 't' } })
      if (u.pathname === '/intern-awb') return raspunsJson(200, okPentru(JSON.parse(init.body))); return raspunsJson(502, { eroare: 'html' }) })
    const r = await executaActiuneFan({ corp: { actiune: 'trimite', lot_id: LOT.id, plic_ids: fx.plicuri.map(x => x.id), intentie: K(1) }, lot: LOT, uid: UID, proiectCod: 'TEST-RAZVAN' }, b.deps)
    expect(r.body).toMatchObject({ cod: 'ok', incheiata: true, generate: 2, etichete_eroare: 'eticheta_neconfirmata', http: 502, tiraj: { nr: 1 } })
    expect(b.intentii.get(K(1))).toEqual({ stare: 'incheiata' })
    expect(mesajTrimitere(r.body)).toMatch(/AWB-urile există; foile AWB nu s-au putut descărca acum/)
  })
})

describe('F1 — fanLot.js: starea butonului, plafonul, lista, registrul local al intenției (§1, §7.2, §8.3)', () => {
  const baza = { evidentaInstalata: true, esteOperator: true, fanLot: { test: true }, proiectCod: 'TEST-RAZVAN', selectate: 3, plafon: { limita_zi: 20, aprobate: 2, incap: 18 } }
  it('stareTrimitere: activ doar pentru operator (din BD), pe proiect TEST, cu evidența instalată, lot netipărit, fără intenție vie, cu plicuri alese; motivele sunt numite', () => {
    expect(stareTrimitere(baza)).toEqual({ activ: true, motiv: '', avertisment: '' })
    expect(stareTrimitere({ ...baza, fanLot: null })).toMatchObject({ activ: true })   // lotul nemarcat: marcajul îl pune comanda (cereMarcaj: false)
    expect(stareTrimitere({ ...baza, proiectCod: 'LOT1-X' })).toMatchObject({ activ: false, motiv: expect.stringMatching(/proiecte de TEST/) })
    expect(stareTrimitere({ ...baza, transportActiv: false })).toMatchObject({ activ: false, motiv: 'transport oprit' })
    expect(stareTrimitere({ ...baza, evidentaInstalata: false })).toMatchObject({ activ: false, motiv: expect.stringMatching(/migrarea neaplicată/) })
    expect(stareTrimitere({ ...baza, esteOperator: null })).toMatchObject({ activ: false, motiv: expect.stringMatching(/nu s-a putut verifica/) })   // L18: neconfirmat ≠ fals
    expect(stareTrimitere({ ...baza, esteOperator: false })).toMatchObject({ activ: false, motiv: MESAJ_DOAR_OPERATOR })
    expect(stareTrimitere({ ...baza, fanLot: { test: true, tiraj_cheie: 'a'.repeat(64) } })).toMatchObject({ activ: false, motiv: expect.stringMatching(/lotul e tipărit/) })
    const acum = Date.parse('2026-11-18T10:00:00Z')
    expect(stareTrimitere({ ...baza, intentieVie: { lucru_pana_la: '2026-11-18T10:05:00Z' }, acumMs: acum })).toMatchObject({ activ: false, motiv: expect.stringMatching(/așteaptă până la 12:05/) })
    expect(stareTrimitere({ ...baza, intentieVie: { lucru_pana_la: '2026-11-18T09:55:00Z' }, acumMs: acum })).toMatchObject({ activ: true })   // arenda expirată: comanda o preia
    expect(stareTrimitere({ ...baza, selectate: 0 })).toMatchObject({ activ: false, motiv: 'alege cel puțin un plic gata' })
  })
  it('avertismentul Q2 (decis A): mai multe plicuri decât încap → TOATĂ trimiterea așteaptă; plafonul necitit → avertisment, nu „0” (L18)', () => {
    expect(stareTrimitere({ ...baza, selectate: 19 }).avertisment).toBe('Ai ales 19 plicuri, dar azi mai încap doar 18 fără aprobare: TOATĂ trimiterea va aștepta aprobarea proprietarului. Poți debifa 1 și trimite azi doar cât încape.')
    expect(stareTrimitere({ ...baza, selectate: 18 }).avertisment).toBe('')
    expect(stareTrimitere({ ...baza, plafon: null })).toMatchObject({ activ: true, avertisment: expect.stringMatching(/nu s-a putut citi/) })
    expect(stareTrimitere({ ...baza, selectate: 1, plafon: { limita_zi: 0, aprobate: 0, incap: 0 } }).avertisment).toMatch(/azi mai încap doar 0/)
  })
  it('textPlafonAzi: cât mai încape azi; limita 0 = totul cere aprobare; necitit = mesaj explicit, nu „0” (L18)', () => {
    expect(textPlafonAzi({ limita_zi: 20, aprobate: 2, incap: 18 })).toBe('Azi mai poți trimite 18 plicuri fără aprobarea proprietarului (plafon 20/zi; 2 aprobate azi).')
    expect(textPlafonAzi({ limita_zi: 20, aprobate: 19, incap: 1 })).toMatch(/^Azi mai poți trimite 1 plic fără/)
    expect(textPlafonAzi({ limita_zi: 0, aprobate: 0, incap: 0 })).toMatch(/^Plafonul zilei e 0: orice trimitere așteaptă aprobarea/)
    for (const p of [null, undefined, {}, { limita_zi: '20', incap: 18 }, { limita_zi: 20 }]) expect(textPlafonAzi(p)).toMatch(/^Plafonul zilei nu s-a putut citi/)
  })
  it('plicuriTrimisibile: gata + fără rând viu sau cu rândul propus / aprobat = trimisibil; cu AWB / în curs / de aprobat = blocat cu starea; eroare / anulat / retras nu sunt vii', async () => {
    const fx = await fixtura(6, { faraTelefon: [6] })
    const randuri = [{ plic_id: plicId(1), stare: 'propus' }, { plic_id: plicId(2), stare: 'generat', awb: '2000000002' }, { plic_id: plicId(3), stare: 'de_aprobat' }, { plic_id: plicId(4), stare: 'retras' }, { plic_id: plicId(5), stare: 'in_curs' }]
    const l = plicuriTrimisibile(fx.pregatite, randuri)
    expect(l.map(x => [x.plic.nr_plic, x.trimisibil, x.motiv])).toEqual([[nr(1), true, ''], [nr(2), false, 'AWB generat'], [nr(3), false, ETICHETE_STARE_FAN.de_aprobat], [nr(4), true, ''], [nr(5), false, ETICHETE_STARE_FAN.in_curs], [nr(6), false, expect.stringMatching(/telefon/i)]])
    expect(l[1].rand.awb).toBe('2000000002'); expect(l[3].rand).toBeNull()
    expect(plicuriTrimisibile([], [])).toEqual([]); expect(plicuriTrimisibile(null, null)).toEqual([])
  })
  it('registrul local (L05 în UI): o intrare pe cheie, scrisă și VERIFICATĂ prin recitire înainte de apel; stocarea blocată / plină = false (nu se trimite); ștergerea e verificată', () => {
    const mem = new Map()
    const storage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
    const reg = registruIntentii(storage)
    expect(reg.scrie(K(1), { lot_id: LOT.id, plic_ids: [plicId(1), plicId(2)], hash_cerere: 'a'.repeat(64) })).toBe(true)
    expect(mem.get(PREFIX_REGISTRU_FAN + K(1))).toMatch(/"lot_id":/)
    expect(reg.citeste(K(1))).toMatchObject({ cheie: K(1), lot_id: LOT.id, plic_ids: [plicId(1), plicId(2)], hash_cerere: 'a'.repeat(64), inceput_la: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    expect(reg.scrie(K(2), { lot_id: 'alt-lot', plic_ids: [plicId(3)], hash_cerere: 'b'.repeat(64), inceput_la: '2026-11-18T08:00:00.000Z' })).toBe(true)
    expect(reg.toate().map(r => r.cheie)).toEqual([K(2), K(1)])   // în ordinea pornirii
    expect(reg.peLot(LOT.id).map(r => r.cheie)).toEqual([K(1)])
    for (const rau of [{ lot_id: LOT.id, plic_ids: [], hash_cerere: 'a' }, { lot_id: null, plic_ids: [plicId(1)], hash_cerere: 'a' }, { lot_id: LOT.id, plic_ids: [plicId(1)] }]) expect(reg.scrie(K(3), rau)).toBe(false)
    expect(reg.sterge(K(1))).toBe(true); expect(reg.citeste(K(1))).toBeNull(); expect(reg.sterge(K(1))).toBe(true)
    // stocarea aruncă la scriere (plină / blocată) → false; stocarea care „înghite” scrierea (recitirea nu găsește) → false; stocare lipsă → nimic nu aruncă
    expect(registruIntentii({ getItem: () => null, setItem: () => { throw new Error('QuotaExceeded') }, removeItem: () => {}, key: () => null, length: 0 }).scrie(K(4), { lot_id: LOT.id, plic_ids: [plicId(1)], hash_cerere: 'a' })).toBe(false)
    expect(registruIntentii({ getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 }).scrie(K(4), { lot_id: LOT.id, plic_ids: [plicId(1)], hash_cerere: 'a' })).toBe(false)
    const gol = registruIntentii(undefined)
    expect(gol.toate()).toEqual([]); expect(gol.citeste(K(1))).toBeNull(); expect(gol.scrie(K(1), { lot_id: LOT.id, plic_ids: [plicId(1)], hash_cerere: 'a' })).toBe(false)
    // intrarea stricată (JSON invalid) nu aruncă și nu apare
    mem.set(PREFIX_REGISTRU_FAN + K(5), '{stricat'); expect(reg.citeste(K(5))).toBeNull(); expect(reg.toate().map(r => r.cheie)).toEqual([K(2)])
  })
  it(`dublu-click / al doilea tab: o intrare pe același lot pornită de < ${ARENDA_INTENTIE_MIN} min blochează o cheie nouă local; după arendă sau pe alt lot nu`, () => {
    const acum = Date.parse('2026-11-18T10:00:00Z')
    const e = (min, lot = LOT.id) => ({ cheie: K(1), lot_id: lot, inceput_la: new Date(acum - min * 60000).toISOString() })
    expect(intentieLocalaBlocanta([e(1)], LOT.id, acum)).toMatchObject({ cheie: K(1) })
    expect(intentieLocalaBlocanta([e(ARENDA_INTENTIE_MIN - 0.01)], LOT.id, acum)).not.toBeNull()
    expect(intentieLocalaBlocanta([e(ARENDA_INTENTIE_MIN)], LOT.id, acum)).toBeNull()
    expect(intentieLocalaBlocanta([e(1, 'alt-lot')], LOT.id, acum)).toBeNull()
    expect(intentieLocalaBlocanta([{ cheie: K(1), lot_id: LOT.id, inceput_la: 'cândva' }], LOT.id, acum)).toBeNull(); expect(intentieLocalaBlocanta(null, LOT.id, acum)).toBeNull()
    expect(MIG).toMatch(new RegExp(`v_lucru interval := interval '${ARENDA_INTENTIE_MIN} minutes'`))   // aceeași arendă în BD (L19)
  })
  it('rezultatDovedit (§8.3): iese din registru DOAR la rezultat dovedit — ok + incheiata, refuz determinist al BD fără scriere, cerere invalidă, garda înaintea comenzii; NU la incheiata:false / RD030 / RD033 / 403 / 503 / lipsă', () => {
    const da = [{ cod: 'ok', incheiata: true }, { cod: 'ok', incheiata: true, replay: true }, { cod: 'cerere_invalida' }, { cod: 'transport_real_doar_test' },
      ...['RD034', 'RD036', 'RD037', '22023', 'P0001', 'P0002', '23505'].map(cod_bd => ({ cod: 'comanda_refuzata', cod_bd }))]
    const nu = [{ cod: 'ok', incheiata: false }, { cod: 'ok' }, { cod: 'ok', incheiata: false, incheiere_neconfirmata: true }, { cod: 'comanda_refuzata', cod_bd: 'RD030' }, { cod: 'comanda_refuzata', cod_bd: 'RD033' },
      { cod: 'comanda_refuzata', cod_bd: 'RD032' }, { cod: 'transport_real_doar_test', mod: 'noua' }, { cod: 'transport_real_doar_test', cod_bd: 'RD032', mod: 'noua' }, { cod: 'non_operator' }, { cod: 'comanda_neconfirmata' },
      { cod: 'scriere_neconfirmata' }, { cod: 'citire_neconfirmata' }, { cod: 'transport_neconfigurat' }, null, undefined, 'text', {}]
    for (const c of da) expect([c, rezultatDovedit(c)]).toEqual([c, true])
    for (const c of nu) expect([c, rezultatDovedit(c)]).toEqual([c, false])
  })
  it('deciziaIntentiei: cheia lipsă / încheiată / neîncheiată → iese; rânduri nelămurite → „Verifică la curier”; in_curs cu arenda în viitor → așteaptă; expirată → „Reia trimiterea”', () => {
    const acum = Date.parse('2026-11-18T10:00:00Z'), e = { cheie: K(1) }
    expect(deciziaIntentiei(e, null, acum)).toBe('sterge'); expect(deciziaIntentiei(e, { stare: 'incheiata' }, acum)).toBe('sterge'); expect(deciziaIntentiei(e, { stare: 'neincheiata' }, acum)).toBe('sterge')
    expect(deciziaIntentiei(e, { stare: 'in_curs', necunoscute: 2, lucru_pana_la: '2026-11-18T10:05:00Z' }, acum)).toBe('verifica')
    expect(deciziaIntentiei(e, { stare: 'in_curs', necunoscute: '1', lucru_pana_la: '2026-11-18T09:00:00Z' }, acum)).toBe('verifica')   // numărul vine ca text din PostgREST
    expect(deciziaIntentiei(e, { stare: 'in_curs', necunoscute: 0, lucru_pana_la: '2026-11-18T10:05:00Z' }, acum)).toBe('asteapta')
    expect(deciziaIntentiei(e, { stare: 'in_curs', necunoscute: 0, lucru_pana_la: '2026-11-18T09:59:59Z' }, acum)).toBe('reia')
  })
  it('ziRo: ziua României (iarna UTC+2, vara UTC+3), aceeași definiție ca zi_ro din BD (L17)', () => {
    expect(ziRo(Date.parse('2026-11-18T22:30:00Z'))).toBe('2026-11-19'); expect(ziRo(Date.parse('2026-11-18T21:59:00Z'))).toBe('2026-11-18')
    expect(ziRo(Date.parse('2026-07-01T21:30:00Z'))).toBe('2026-07-02')
    expect(MIG).toMatch(/v_azi := \(clock_timestamp\(\) AT TIME ZONE 'Europe\/Bucharest'\)::date/)
  })
})

describe('F1 — mesajul unic al operatorului (spec §8.5), o singură definiție (L19)', () => {
  const scapa = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  it('tabelul de cazuri: codul din răspuns → ce vede operatorul', () => {
    const cazuri = [
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 27.16, tiraj: { id: 'ABCD1234' }, pdf_parti: ['x'], parti: 1 }, /^1 AWB generat\. Tarif: 27,16 lei fără TVA\.\nFoile AWB au fost descărcate \(tirajul ABCD1234\): pune fiecare AWB în buzunarul plicului, după pagina de control\.$/],
      [{ cod: 'ok', incheiata: true, generate: 2, tarif_total: null, tiraj: { id: 'ABCD1234' }, pdf_parti: ['x', 'y', 'z'], parti: 3 }, /^2 AWB-uri generate\. Tarif: necunoscut\.\nFoile AWB au fost descărcate \(tirajul ABCD1234, 3 fișiere\)/],
      [{ cod: 'ok', incheiata: true, generate: 1, etichete_eroare: 'lot_neincheiat' }, new RegExp(`\\n${scapa(MESAJ_LOT_NEINCHEIAT)}$`)],
      // tirajul a început, dar PDF-ul a picat după el: nu se afirmă „descărcate” (L18)
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 1, tiraj: { id: 'ABCD1234' }, pdf_parti: [], etichete_eroare: 'eticheta_neconfirmata' }, /^1 AWB generat\. Tarif: 1,00 lei fără TVA\.\nAWB-urile există; foile AWB nu s-au putut descărca acum/],
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 1, tiraj: { id: 'ABCD1234' }, pdf_parti: [] }, /^1 AWB generat\. Tarif: 1,00 lei fără TVA\.$/],
      [{ cod: 'ok', incheiata: true, generate: 0, de_aprobat: 4, azi: { incapeau: 2 } }, /^Toate cele 4 plicuri așteaptă aprobarea proprietarului \(azi mai încăpeau 2\)\. După aprobare, apasă din nou „Trimite la curier”\.$/],
      [{ cod: 'ok', incheiata: true, generate: 0, de_aprobat: 1 }, /^Toate cele 1 plic așteaptă aprobarea proprietarului\. După aprobare/],
      [{ cod: 'ok', incheiata: false, necunoscute: 3 }, /^Răspunsul curierului nu s-a confirmat pentru 3 plicuri\. NU retrimite\. Apasă „Verifică la curier” după 10 minute\.$/],
      [{ cod: 'ok', incheiata: true, generate: 0, nimic_de_trimis: true }, /^Nimic de trimis: plicurile alese au deja AWB sau sunt excluse \(motivele mai jos\)\.$/],
      [{ cod: 'ok', incheiata: true, generate: 0, respinse: [{ nr_plic: 'PL-X-1', motiv_cod: 'adresa' }] }, /^Niciun AWB generat: 1 plic respins de curier\.\nPL-X-1 — adresa nu e recunoscută de curier \(județ \/ localitate \/ stradă\)\nPlicurile respinse: corectează datele/],
      [{ cod: 'ok', incheiata: true, generate: 0, respinse: [{ nr_plic: 'PL-X-1', motiv_cod: 'name' }, { nr_plic: 'PL-X-2', motiv_cod: 'necunoscut' }] }, /2 plicuri respinse de curier\.\nPL-X-1 — curierul a respins expedierea; detalii în contul curierului\nPL-X-2 — curierul a respins expedierea/],
      [{ cod: 'ok', incheiata: true, generate: 0, ramase: 5, oprit: '429' }, /^Trimiterea s-a încheiat fără AWB-uri noi\.\nCurierul a cerut o pauză; restul \(5 plicuri\) se trimite mai târziu: apasă din nou „Trimite la curier” peste câteva minute\.$/],
      [{ cod: 'ok', incheiata: true, generate: 500, ramase: 12, oprit: 'limita_solicitari', etichete_eroare: 'lot_neincheiat' }, /\nS-au trimis 500; mai sunt 12: apasă din nou „Trimite la curier”\.$/],
      [{ cod: 'ok', incheiata: true, generate: 0, oprit: 'rezervare_refuzata' }, /Datele unui plic s-au schimbat între timp; nimic trimis pentru acea bucată\. Apasă din nou „Trimite la curier”\./],
      [{ cod: 'ok', incheiata: false, necunoscute: 1, oprit: 'scriere_neconfirmata' }, /NU retrimite\.[\s\S]*Răspunsul curierului nu s-a putut înscrie: NU retrimite; „Verifică la curier” după 10 minute\./],
      [{ cod: 'ok', incheiata: true, replay: true, generate: 2, incheiata_la: '2026-11-18T10:00:00Z', tiraj: { id: 'X' } }, /^Rezultat deja înregistrat la 12:00 \(aceeași apăsare\): nimic retrimis\.\n2 AWB-uri generate/],
      [{ cod: 'ok', incheiata: true, mod: 'reluare', generate: 1, tarif_total: 1 }, /^Trimiterea întreruptă a fost reluată\.\n1 AWB generat/],
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 1, excluse: [{ nr_plic: 'PL-X-9', motiv_cod: 'date_schimbate' }] }, /PL-X-9 — datele s-au schimbat după aprobare; nu a intrat în reluare \(„Trimite” din nou\)/],
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 1, excluse: [{ nr_plic: 'PL-X-9', motiv_cod: 'are_deja_expediere' }, { plic_id: 'p', motiv_cod: 'plic_necitibil' }], retrase: [{ nr_plic: 'PL-X-8', motiv_cod: 'plic_mutat' }] }, /PL-X-9 — exclus \(are_deja_expediere\)\np — plicul nu s-a putut citi\nPL-X-8 — scos din trimitere: plicul nu mai e în lot/],
      [{ cod: 'ok', incheiata: true, generate: 1, tarif_total: 1, etichete_eroare: 'eticheta_neconfirmata' }, /AWB-urile există; foile AWB nu s-au putut descărca acum: „Descarcă AWB-urile” mai târziu\./],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD030', mesaj: 'redari fan: trimiterea e in curs; asteapta pana la 14:35' }, /^Trimiterea e în curs \(alt tab sau încă rulează\); așteaptă până la 14:35\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD030' }, /așteaptă câteva minute\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD031' }, new RegExp(`^${scapa(MESAJ_LOT_NEINCHEIAT)}$`)],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD032' }, new RegExp(`^${scapa(MESAJ_DOAR_TEST_BD)}$`)],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD033', mesaj: 'redari fan: 2 plicuri au rezultatul neconfirmat' }, /^2 plicuri au rezultatul neconfirmat; întâi „Verifică la curier”\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD034' }, /^Trimiterea anterioară a fost închisă; apasă din nou „Trimite la curier”\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD035' }, /^Anularea AWB-ului e deja în curs/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD036' }, /^Lotul e deja tipărit; plicurile noi merg într-un lot nou de plicuire\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: 'RD037' }, /^Lotul are deja plicuri în așteptarea aprobării proprietarului; așteaptă decizia, retrage cererea sau alege mai puține plicuri\.$/],
      [{ cod: 'comanda_refuzata', cod_bd: '22023' }, /^Cererea nu se potrivește cu trimiterea anterioară/],
      [{ cod: 'comanda_refuzata', cod_bd: 'P0001', mesaj: 'redari fan: lotul ar avea 21 plicuri aprobate, peste plafonul lotului (20)' }, /^Refuzat de regulile evidenței: redari fan: lotul ar avea 21 plicuri aprobate, peste plafonul lotului \(20\)\. Nimic trimis\.$/],
      [{ cod: 'transport_real_doar_test' }, new RegExp(`^${scapa(MESAJ_DOAR_TEST_BD)}$`)],
      [{ cod: 'non_operator' }, new RegExp(`^${scapa(MESAJ_NON_OPERATOR)}$`)],
      [{ cod: 'transport_neconfigurat' }, new RegExp(`^${scapa(MESAJ_LEGATURA_CURIER)}$`)], [{ cod: 'autentificare_fan_neconfirmata' }, new RegExp(`^${scapa(MESAJ_LEGATURA_CURIER)}$`)],
      [{ cod: 'cerere_invalida' }, /^Cererea e invalidă/], [{ cod: 'transport_real_oprit' }, /^Transport oprit/],
      [{ cod: 'comanda_neconfirmata' }, /^Rezultat neconfirmat \(comanda_neconfirmata\): reîncarcă evidența; dacă trimiterea apare neîncheiată, „Reia trimiterea”\. Nu reapăsa orbește\.$/],
      [null, /^Rezultat neconfirmat: reîncarcă evidența; dacă trimiterea apare neîncheiată, „Reia trimiterea”\.$/],
    ]
    for (const [corp, re] of cazuri) expect([JSON.stringify(corp), mesajTrimitere(corp)]).toEqual([JSON.stringify(corp), expect.stringMatching(re)])
  })
  it('mesajul nu conține texte / valori ale curierului și nu afirmă nimic neconfirmat: necunoscut ≠ 0, tarif lipsă = „necunoscut” (L18)', () => {
    expect(mesajTrimitere({ cod: 'ok', incheiata: true, generate: 1, tarif_total: 0 })).toMatch(/Tarif: 0,00 lei/)
    expect(mesajTrimitere({ cod: 'ok', incheiata: true, generate: 1 })).toMatch(/Tarif: necunoscut/)
    expect(mesajTrimitere({ cod: 'ok', incheiata: false })).toMatch(/pentru \? plicuri\. NU retrimite/)
    expect(textRespins({ nr_plic: 'PL-1', motiv_cod: 'phone' })).toBe('PL-1 — telefonul lipsește sau e greșit'); expect(textRespins(null)).toMatch(/^PL-\? — curierul a respins/)
    expect(textExclus({ nr_plic: 'PL-1', motiv_cod: 'in_asteptare_aprobare' })).toBe('PL-1 — așteaptă decizia proprietarului'); expect(textRetras({ nr_plic: 'PL-1', motiv_cod: 'lot_tiparit' })).toBe('PL-1 — scos din trimitere: lotul e tipărit')
    for (const c of Object.keys(CODURI_FAN)) expect(mesajRefuzComanda(c)).not.toMatch(/RD03|redari fan:/)
    expect(mesajRefuzComanda('XX000', 'ceva')).toBe('Comanda a fost refuzată (XX000): nimic trimis. ceva')
  })
  it('mesajEdgeFan (acțiunile celelalte) cunoaște codurile noi: non_operator, comanda_refuzata, lot_neincheiat, anulare_in_curs, stergere_refuzata, nu_e_gasit_in_borderou, legătura cu curierul', () => {
    const m = (cod, extra = {}) => mesajEdgeFan({ data: { cod, ...extra } })
    expect(m('non_operator')).toBe(MESAJ_NON_OPERATOR); expect(m('lot_neincheiat')).toBe(MESAJ_LOT_NEINCHEIAT)
    expect(m('comanda_refuzata', { cod_bd: 'RD036' })).toMatch(/^Lotul e deja tipărit/); expect(m('anulare_in_curs')).toMatch(/^Anularea AWB-ului e deja în curs/)
    expect(m('stergere_refuzata')).toMatch(/^Nu s-a anulat: curierul spune că AWB-ul a fost deja preluat/); expect(m('doar_awb_generat_neridicat')).toMatch(/doar un AWB generat și neridicat/)
    expect(m('nu_e_gasit_in_borderou')).toMatch(/nimic confirmat/); expect(m('autorizare_neconfirmata')).toMatch(/nimic trimis\. Reîncearcă/)
    expect(m('transport_neconfigurat')).toBe(MESAJ_LEGATURA_CURIER); expect(m('autentificare_fan_neconfirmata')).toBe(MESAJ_LEGATURA_CURIER)
  })
  it('mesajele ecranului coincid cu tabelul §8.5 al specificației pe frazele-cheie', () => {
    for (const fraza of ['NU retrimite', 'Doar operatorii numiți de proprietar pot trimite', 'AWB-urile se tipăresc după ce se termină trimiterea lotului', 'Curierul a cerut o pauză; restul se trimite mai târziu',
      'Trimiterea anterioară a fost închisă; apasă din nou «Trimite»', 'Nimic de trimis: plicurile alese au deja AWB sau sunt excluse (motivele mai jos)', 'Transportul e permis doar pe proiecte de TEST (Testul 1)'])
      expect([fraza, SPEC.includes(fraza)]).toEqual([fraza, true])
    expect(MESAJ_NON_OPERATOR).toMatch(/^Doar operatorii numiți de proprietar pot trimite/); expect(MESAJ_DOAR_TEST_BD).toMatch(/^Transportul e permis doar pe proiecte de TEST \(Testul 1\)/)
  })
})

describe('F1 — ecranul operatorului (FanTrimitere.jsx): butonul unic și secțiunile owner-ului', () => {
  const nimic = () => {}
  const props = async (o = {}) => { const fx = await fixtura(2); return { proiect: { cod: 'TEST-RAZVAN' }, lot: { id: LOT.id, nr_lot: 'PP-0001' }, fanLot: { test: true }, pregatite: fx.pregatite, awb: fx.randuri.map(r => ({ ...r, stare: 'propus' })),
    esteOwner: false, esteOperator: true, evidentaInstalata: true, plafon: { limita_zi: 20, aprobate: 2, incap: 18, presupunere_429: true, doar_proiecte_test: true }, intentii: [], cereri: [], ruleaza: nimic, edge: nimic, rpc: nimic, ...o } }
  const butonTrimite = html => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].find(m => /^Trimite la curier/.test(m[1]))
  it('operatorul numit: lista cu „gata” pe fiecare plic, plafonul zilei, butonul activ cu numărul plicurilor bifate', async () => {
    const html = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props()))
    expect(html).toMatch(/Trimite la curier/); expect(html).toMatch(/Azi mai poți trimite 18 plicuri fără aprobarea proprietarului/)
    expect((html.match(/✓ gata/g) || []).length).toBe(2); expect(html).toMatch(/Selectate: 2 din 2 plicuri\./)
    const b = butonTrimite(html); expect(b[1]).toBe('Trimite la curier (2 plicuri)'); expect(b[0]).not.toMatch(/disabled=""/)
  })
  it('cine NU e operator (decizia vine din BD): butonul dezactivat cu motivul, textul explică lista owner-ului; neconfirmat (null) = dezactivat cu „nu s-a putut verifica”', async () => {
    const html = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ esteOperator: false })))
    expect(butonTrimite(html)[0]).toMatch(/disabled=""/); expect(html).toMatch(/Nu ești pe lista operatorilor numiți de proprietar: butonul e dezactivat/); expect(html).toMatch(new RegExp(`Butonul e dezactivat: ${MESAJ_DOAR_OPERATOR}`))
    const h2 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ esteOperator: null })))
    expect(butonTrimite(h2)[0]).toMatch(/disabled=""/); expect(h2).toMatch(/Dreptul de operator nu s-a putut verifica/)
    // owner-ul care nu e în listă e tot operator în BD (fn_red_fan_e_operator îl include): ecranul primește esteOperator = true de acolo, nu îl derivă din esteOwner
    const h3 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ esteOwner: true, esteOperator: false })))
    expect(butonTrimite(h3)[0]).toMatch(/disabled=""/)
  })
  it('plafonul necitit → mesaj, nu „0”; avertismentul Q2 când sunt alese mai multe decât încap; lotul tipărit → butonul dezactivat; intenția vie → avertisment + buton dezactivat', async () => {
    const h1 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ plafon: null })))
    expect(h1).toMatch(/Plafonul zilei nu s-a putut citi/); expect(h1).not.toMatch(/mai poți trimite 0/)
    const h2 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ plafon: { limita_zi: 20, aprobate: 19, incap: 1 } })))
    expect(h2).toMatch(/Ai ales 2 plicuri, dar azi mai încap doar 1 fără aprobare: TOATĂ trimiterea va aștepta aprobarea proprietarului/)
    const h3 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ fanLot: { test: true, tiraj_cheie: 'a'.repeat(64) } })))
    expect(butonTrimite(h3)[0]).toMatch(/disabled=""/); expect(h3).toMatch(/lotul e tipărit: plicurile noi merg într-un lot nou de plicuire/)
    const h4 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ intentii: [{ cheie: K(1), stare: 'in_curs', lucru_pana_la: new Date(Date.now() + 300000).toISOString(), inceput_la: new Date().toISOString(), ramase: 2, necunoscute: 0 }] })))
    expect(butonTrimite(h4)[0]).toMatch(/disabled=""/); expect(h4).toMatch(/O trimitere e în curs pe acest lot/)
    const h5 = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ intentii: [{ cheie: K(1), stare: 'in_curs', lucru_pana_la: new Date(Date.now() - 1000).toISOString(), inceput_la: new Date().toISOString(), ramase: 0, necunoscute: 2 }] })))
    expect(h5).toMatch(/Trimitere neîncheiată din alt browser[^<]*2 neconfirmate\): „Verifică la curier”/)
  })
  it('cererea de aprobare deschisă: operatorul vede „Retrage cererea”; owner-ul vede „Aprobă” / „Respinge…” în CereriAprobare, operatorul nu', async () => {
    const cerere = { id: K(5), n: 3, stare: 'deschisa', cerut_la: '2026-11-18T10:00:00Z' }
    const html = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ cereri: [cerere] })))
    expect(html).toMatch(/Cerere de aprobare deschisă din 18\.11 12:00: 3 plicuri așteaptă decizia proprietarului\./); expect(html).toMatch(/Retrage cererea/)
    const owner = renderToStaticMarkup(React.createElement(CereriAprobare, { cereri: [cerere], esteOwner: true, ruleaza: nimic, rpc: nimic }))
    expect(owner).toMatch(/>Aprobă</); expect(owner).toMatch(/>Respinge…</)
    const op = renderToStaticMarkup(React.createElement(CereriAprobare, { cereri: [cerere], esteOwner: false, ruleaza: nimic, rpc: nimic }))
    expect(op).not.toMatch(/>Aprobă</); expect(op).toMatch(/3 plicuri · deschisa/)
    expect(renderToStaticMarkup(React.createElement(CereriAprobare, { cereri: null, ruleaza: nimic, rpc: nimic }))).toBe('')
  })
  it('„Retrage din trimitere” pe rândurile propus / aprobat; „Anulează AWB-ul…” pe generat, cu motivul din listă (alt_motiv cere notă); rândul cu anulare cerută nu mai are buton', async () => {
    const fx = await fixtura(3)
    const awb = [{ ...fx.randuri[0], stare: 'aprobat' }, { ...fx.randuri[1], stare: 'generat', awb: '2000000002', tarif: 9.5 }, { ...fx.randuri[2], stare: 'generat', awb: '2000000003', anulare_ceruta_la: '2026-11-18T10:00:00Z' }]
    const html = renderToStaticMarkup(React.createElement(TrimiteLaCurier, await props({ awb })))
    expect(html).toMatch(/Retrage din trimitere \(1\) · Anulează un AWB neridicat \(2\)/)
    expect((html.match(/>Anulează AWB-ul…</g) || []).length).toBe(1); expect(html).toMatch(/anulare cerută, așteaptă curierul/)
    expect(MOTIVE_ANULARE).toEqual(['netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv']); for (const m of MOTIVE_ANULARE) expect(ETICHETE_MOTIV_ANULARE[m]).toBeTruthy()
    expect(MIG).toMatch(/anulare_ceruta_motiv IN \('netiparit_3_zile', 'neridicat_3_zile', 'plic_retras', 'date_gresite', 'alt_motiv'\)/)   // aceeași listă în CHECK (L19)
  })
  it('SetariZi (owner): plafonul zilei, presupunerea P429 cu motiv și garda „doar TEST” din BD, toate afișate din v_red_fan_plafon_azi; „necitit” când lipsește', () => {
    const html = renderToStaticMarkup(React.createElement(SetariZi, { plafon: { limita_zi: 20, aprobate: 2, incap: 18, presupunere_429: false, doar_proiecte_test: true }, activ: true, ruleaza: nimic, rpc: nimic }))
    expect(html).toMatch(/20 AWB-uri\/zi \(azi 2 aprobate, mai încap 18\)/); expect(html).toMatch(/<b>OPRITĂ<\/b>/); expect(html).toMatch(/Repune \(cu motiv\)…/); expect(html).toMatch(/Garda „doar proiecte de TEST” în BD: pornită/)
    const gol = renderToStaticMarkup(React.createElement(SetariZi, { plafon: null, activ: true, ruleaza: nimic, rpc: nimic }))
    expect(gol).toMatch(/necitit/); expect(gol).not.toMatch(/Repune|Oprește/)
    expect(renderToStaticMarkup(React.createElement(SetariZi, { plafon: null, activ: false, ruleaza: nimic, rpc: nimic }))).toBe('')
  })
  it('ecranul cheamă „trimite” cu cheia din registru și plicurile bifate; „Confirmă: găsit” trece prin reconciliaza cu confirma:{id}; anularea prin sterge_awb cu motiv_cod — toate prin funcția edge (sursa)', () => {
    const src = readFileSync('src/redari/ui/FanTrimitere.jsx', 'utf8').replace(/\r/g, '')
    expect(src).toMatch(/if \(!reg\.scrie\(cheie, \{ lot_id: lot\.id, plic_ids: ids, hash_cerere: hash \}\)\) return/)   // scris + verificat ÎNAINTE de apel
    expect(src).toMatch(/const \{ corp \} = await edge\('trimite', \{ plic_ids: ids, intentie: cheie \}\)\n    if \(rezultatDovedit\(corp\)\) reg\.sterge\(cheie\)/)   // iese DOAR la rezultat dovedit
    expect(src).toMatch(/trimiteCu\(globalThis\.crypto\.randomUUID\(\), selectate, null\)/); expect(src).toMatch(/onClick=\{\(\) => trimiteCu\(e\.cheie, e\.plic_ids, e\)\}>Reia trimiterea/)   // reluarea = aceeași cheie
    expect(src).toMatch(/edge\('reconciliaza', \{ data: propuneri\.data, confirma: \{ id: p\.id \} \}\)/)
    expect(src).toMatch(/edge\('sterge_awb', \{ rand_id: a\.rand\.id, motiv_cod: a\.motiv, nota:/)
    expect(src).toMatch(/rpc\('fn_red_fan_retrage', \{ p_id: r\.id, p_motiv_cod: esteOwner \? 'owner' : 'operator' \}\)/); expect(src).toMatch(/rpc\('fn_red_fan_cerere_retrage', \{ p_id: c\.id \}\)/)
    expect(src).not.toMatch(/fn_red_fan_srv_|SERVICE_ROLE/)   // niciun RPC de clasa B din ecran
    // FanAwbPrevizualizare citește dreptul din BD și leagă secțiunea; pașii vechi stau sub „Pași detaliați (owner)”
    const prev = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8').replace(/\r/g, '')
    expect(prev).toMatch(/incearca\(\(\) => client\.rpc\('fn_red_fan_e_operator'\)\)/); expect(prev).toMatch(/esteOperator: typeof op === 'boolean' \? op : null/)
    expect(prev).toMatch(/<TrimiteLaCurier proiect=\{proiect\} lot=\{lot\}/); expect(prev).toMatch(/Pași detaliați \(owner\)/)
  })
})
