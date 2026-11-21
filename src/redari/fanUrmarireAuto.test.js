// Urmărirea AUTOMATĂ a AWB-urilor FAN (decizia owner-ului, 21.11.2026; docs/redari/FAN_URMARIRE_AUTOMATA.md, migrarea 20270102a NEAPLICATĂ).
// Funcția edge redari-fan-urmarire: poarta (cron cu x-intern-secret sau owner), rularea (aceeași urmărire ca butonul), plafonul, oprirea la erori,
// suprapunerea, nicio acțiune care costă. BD-ul (RPC-urile clasei B) e SIMULAT după contractul migrării — semantica SQL reală e probată pe PGlite
// (scripts/pglite/test_redari_fan_urmarire_auto_local.mjs). Așteptările sunt scrise de mână din document (L25), nu din codul testat. Fără rețea.
// + regula contradicțiilor în ACELAȘI răspuns (spec §9.2, precondiția F2) în rezumatUrmarireFan, ca tabel de cazuri.
// + mutanți: modulele copiate într-un folder temporar, cu o mutație, trebuie să PICE aceleași verificări.
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as REAL from '../../supabase/functions/_shared/redariFanUrmarireAuto.mjs'
import { rezumatUrmarireFan, URL_FAN } from '../../supabase/functions/_shared/redariFan.mjs'
import { executaActiuneFan, PAUZA_INTRE_CERERI_MS } from '../../supabase/functions/_shared/redariFanTransport.mjs'

const RUL = '0a000000-0000-4000-8000-000000000001'
const OWNER = '00000000-0000-4000-8000-000000000001'
const L1 = '20000000-0000-4000-8000-000000000001', L2 = '20000000-0000-4000-8000-000000000002', LR = '20000000-0000-4000-8000-000000000004'
const rid = (l, i) => `${l.slice(0, 2)}a00000-0000-4000-8000-${String(i).padStart(12, '0')}`
const randuri = (l, n, baza = 7000000000) => Array.from({ length: n }, (_, i) => ({ id: rid(l, i + 1), awb: String(baza + i + 1), stare: 'generat', versiune_urmarire: 3 }))
const lot = (lot_id, n, { proiect_cod = 'TEST-RAZVAN', test = true, baza } = {}) => ({ lot_id, proiect_cod, test, randuri: randuri(lot_id, n, baza) })
const json = (status, corp) => ({ status, json: async () => corp, arrayBuffer: async () => new ArrayBuffer(0) })
// răspunsul FAN la urmărire (forma din documentație, §1): un element pe AWB cerut; C0 = ridicat
const urmarireOk = url => {
  const awbs = new URL(url).searchParams.getAll('awb[]')
  return json(200, { data: awbs.map(a => ({ awbNumber: a, events: [{ id: 'C0', date: '2026-11-20 10:40:00' }] })) })
}

/** BD + curier simulați după contractul 20270102a. `jurnal` = pașii în ORDINE (cine / ce). */
function lume({ start = { rulare_id: RUL, plafon_apeluri: 20, slot: 'seara' }, loturi = [lot(L1, 3)], fanRaspuns = urmarireOk, apel, scrie, incheie, secrete, timp } = {}) {
  const jurnal = [], rpc = [], fetchuri = []
  let apeluri = 0, t = 0
  const deps = {
    rpcServer: async (nume, args) => {
      rpc.push({ nume, args }); jurnal.push('rpc:' + nume)
      if (nume === 'fn_red_fan_srv_rulare_incepe') return typeof start === 'function' ? start(args) : { data: start }
      if (nume === 'fn_red_fan_srv_de_urmarit') return typeof loturi === 'function' ? loturi(args) : { data: { loturi, randuri: loturi.reduce((n, l) => n + l.randuri.length, 0), limita: 2000 } }
      if (nume === 'fn_red_fan_srv_rulare_apel') {
        if (!apel) return { data: ++apeluri }
        const r = apel(apeluri + 1, args)
        if (Number.isInteger(r?.data)) apeluri = r.data
        return r
      }
      if (nume === 'fn_red_fan_srv_urmarire') { if (scrie) return scrie(args); const n = args.p_randuri.length; return { data: { scrise: n, pastrate: 0, depasite: 0 } } }
      if (nume === 'fn_red_fan_srv_rulare_incheie') {
        if (incheie) return incheie(args)
        return { data: { rulare_id: args.p_rulare, stare: args.p_stare, eroare_cod: args.p_eroare_cod, apeluri, randuri: 0, scrise: 0, pastrate: 0, depasite: 0, deja_inchisa: false } }
      }
      return { error: { code: 'necunoscut_in_proba' } }
    },
    secrete: () => (secrete === undefined ? { username: 'u', password: 'p', clientId: '7' } : secrete),
    fetch: async (url, init = {}) => {
      const u = new URL(url); fetchuri.push({ method: init.method || 'GET', cale: u.pathname, q: u.searchParams }); jurnal.push(`fetch:${init.method || 'GET'} ${u.pathname}`)
      if (u.pathname === '/login') return json(200, { data: { token: 'tok' } })
      return fanRaspuns(url, init)
    },
    pauza: async ms => { jurnal.push('pauza:' + ms) },
    acum: () => (timp ? timp(t++) : 0),
  }
  return { deps, jurnal, rpc, fetchuri }
}
const CRON = { sursa: 'cron', actor: null }
const tracking = f => f.fetchuri.filter(x => x.cale === '/reports/awb/tracking')
const inchidere = f => f.rpc.find(x => x.nume === 'fn_red_fan_srv_rulare_incheie')?.args

// ── verificările, ca funcții pe modul (aceleași pe codul real și pe mutanți) ──
const VERIFICARI = {
  async poarta(M) {
    for (const a of [null, undefined, {}, { sursa: 'altceva' }, { sursa: 'owner', actor: null }, { sursa: 'owner', actor: 'nu-e-uuid' }, 'cron']) {
      const f = lume()
      const r = await M.ruleazaUrmarireAuto(a, f.deps)
      if (r.status !== 401 || f.rpc.length || f.fetchuri.length) return `apelantul ${JSON.stringify(a)} → ${r.status}, ${f.rpc.length} RPC, ${f.fetchuri.length} apeluri FAN`
    }
    return null
  },
  async drum(M) {
    const f = lume({ loturi: [lot(L1, 3), lot(L2, 2, { baza: 7100000000 })] })
    const r = await M.ruleazaUrmarireAuto(CRON, f.deps)
    if (r.status !== 200 || r.body.cod !== 'ok') return `rezultat ${r.status} ${r.body.cod}`
    const scrieri = f.rpc.filter(x => x.nume === 'fn_red_fan_srv_urmarire')
    if (scrieri.length !== 2 || scrieri.some(x => x.args.p_actor !== null || x.args.p_rulare !== RUL)) return 'scrierea nu e cu p_actor NULL + p_rulare = rularea'
    if (scrieri[0].args.p_lot_id !== L1 || scrieri[1].args.p_lot_id !== L2) return 'loturile nu sunt scrise în ordinea selecției'
    if (scrieri[0].args.p_randuri.some(x => x.versiune !== 3 || x.urmarire_stare !== 'ridicat' || x.ridicat_propus !== '2026-11-20')) return 'rândurile nu poartă versiunea citită / propunerea C0'
    const j = f.jurnal.filter(x => !x.startsWith('pauza'))
    const iT = j.map((x, i) => (x === 'fetch:GET /reports/awb/tracking' ? i : -1)).filter(i => i >= 0)
    if (iT.length !== 2 || iT.some(i => j[i - 1] !== 'rpc:fn_red_fan_srv_rulare_apel' && j[i - 2] !== 'rpc:fn_red_fan_srv_rulare_apel')) return 'GET-ul de urmărire nu e precedat de pasul plafonului'
    if (!f.jurnal.includes('pauza:' + PAUZA_INTRE_CERERI_MS)) return 'fără pauză între loturi'
    if (inchidere(f)?.p_stare !== 'incheiata' || inchidere(f)?.p_eroare_cod !== null || inchidere(f)?.p_loturi !== 2) return 'închiderea nu e „incheiata” cu 2 loturi'
    if (f.jurnal.at(-1) !== 'rpc:fn_red_fan_srv_rulare_incheie') return 'închiderea nu e ultimul pas'
    return null
  },
  async nimicCostisitor(M) {
    const f = lume({ loturi: [lot(L1, 150)] })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    const alte = f.fetchuri.filter(x => !((x.method === 'POST' && x.cale === '/login') || (x.method === 'GET' && x.cale === '/reports/awb/tracking')))
    if (alte.length) return 'apeluri FAN în afara listei: ' + alte.map(x => x.method + ' ' + x.cale).join(', ')
    const rpcAlte = f.rpc.filter(x => !REAL.RPC_RULARE.includes(x.nume))
    if (rpcAlte.length) return 'RPC-uri în afara listei: ' + rpcAlte.map(x => x.nume).join(', ')
    // garda de fetch: tot ce costă / schimbă ceva la curier e refuzat local
    const CAZURI = [['POST', '/intern-awb'], ['DELETE', '/awb'], ['GET', '/awb/label'], ['GET', '/reports/awb/confirmations'], ['GET', '/reports/awb'], ['GET', '/reports/awb-events'],
      ['POST', '/order'], ['POST', '/reports/awb/tracking'], ['GET', '/reports/awb/tracking2'], ['GET', '/reports/awb/trackin'], ['GET', '/login']]
    for (const [m, c] of CAZURI) if (M.apelFanPermis(URL_FAN + c + '?clientId=1', m) !== null) return `garda lasă ${m} ${c}`
    if (M.apelFanPermis('https://alt.exemplu.invalid/reports/awb/tracking', 'GET') !== null || M.apelFanPermis('nu e url', 'GET') !== null) return 'garda lasă altă origine'
    if (M.apelFanPermis(URL_FAN + '/reports/awb/tracking?awb[]=1', 'GET') !== '/reports/awb/tracking' || M.apelFanPermis(URL_FAN + '/login?x=1', 'POST') !== '/login') return 'garda refuză calea permisă'
    return null
  },
  async plafon(M) {
    // plafonul local (din BD: 2 apeluri) pe un lot de 250 de rânduri (3 bucăți) → 2 GET-uri, a treia bucată NU se cere
    const f = lume({ start: { rulare_id: RUL, plafon_apeluri: 2 }, loturi: [lot(L1, 250)] })
    const r = await M.ruleazaUrmarireAuto(CRON, f.deps)
    if (tracking(f).length !== 2 || inchidere(f)?.p_stare !== 'oprita_plafon' || inchidere(f)?.p_eroare_cod !== 'plafon_local' || r.body.cod !== 'oprita') return `plafon local: ${tracking(f).length} GET, ${inchidere(f)?.p_stare}/${inchidere(f)?.p_eroare_cod}`
    // refuzul BD-ului (RD040) înaintea apelului: nimic cerut după el
    const g = lume({ loturi: [lot(L1, 250)], apel: n => (n <= 1 ? { data: n } : { error: { code: 'RD040' } }) })
    await M.ruleazaUrmarireAuto(CRON, g.deps)
    if (tracking(g).length !== 1 || inchidere(g)?.p_stare !== 'oprita_plafon' || inchidere(g)?.p_eroare_cod !== 'rd040') return `RD040: ${tracking(g).length} GET, ${inchidere(g)?.p_stare}/${inchidere(g)?.p_eroare_cod}`
    // pasul plafonului cu eroare necunoscută = oprire, nimic cerut
    const h = lume({ apel: () => ({ error: { message: 'retea' } }) })
    await M.ruleazaUrmarireAuto(CRON, h.deps)
    if (tracking(h).length !== 0 || inchidere(h)?.p_stare !== 'oprita_eroare') return 'pasul plafonului cu eroare: s-a cerut totuși curierului'
    // bugetul de timp
    const b = lume({ timp: i => (i === 0 ? 0 : REAL.BUGET_RULARE_MS + 1) })
    await M.ruleazaUrmarireAuto(CRON, b.deps)
    if (tracking(b).length !== 0 || inchidere(b)?.p_eroare_cod !== 'buget_timp') return 'bugetul de timp nu oprește rularea'
    return null
  },
  async oprireLaEroare(M) {
    for (const [st, codAsteptat] of [[429, 'fan_http_429'], [503, 'fan_http_503']]) {
      const f = lume({ loturi: [lot(L1, 2), lot(L2, 2, { baza: 7100000000 })], fanRaspuns: () => json(st, null) })
      await M.ruleazaUrmarireAuto(CRON, f.deps)
      if (tracking(f).length !== 1 || f.rpc.some(x => x.nume === 'fn_red_fan_srv_urmarire') || inchidere(f)?.p_stare !== 'oprita_eroare' || inchidere(f)?.p_eroare_cod !== codAsteptat)
        return `HTTP ${st}: ${tracking(f).length} GET, ${inchidere(f)?.p_stare}/${inchidere(f)?.p_eroare_cod}`
    }
    // timeout / rețea = status 0 → oprire, fără reîncercare
    const t = lume({ fanRaspuns: () => { throw new Error('timeout') } })
    await M.ruleazaUrmarireAuto(CRON, t.deps)
    if (tracking(t).length !== 1 || inchidere(t)?.p_eroare_cod !== 'fan_neconfirmat') return 'timeout: rularea nu s-a oprit „fan_neconfirmat”'
    // formă necunoscută a listei → interpretarea comună: tot „de verificat”, nimic pierdut; scrierea are loc (propuneri), rularea continuă
    const u = lume({ fanRaspuns: () => json(200, { ceva: 1 }) })
    await M.ruleazaUrmarireAuto(CRON, u.deps)
    const s = u.rpc.find(x => x.nume === 'fn_red_fan_srv_urmarire')
    if (!s || s.args.p_randuri.some(x => x.urmarire_stare !== 'de_verificat')) return 'forma necunoscută nu ajunge „de verificat”'
    return null
  },
  async scriereRefuzata(M) {
    // refuz determinist pe un lot (rând schimbat între selecție și scriere) → lotul sărit, următorul urmărit
    const f = lume({ loturi: [lot(L1, 2), lot(L2, 2, { baza: 7100000000 })], scrie: a => (a.p_lot_id === L1 ? { error: { code: 'P0001' } } : { data: { scrise: 2, pastrate: 0, depasite: 0 } }) })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    if (tracking(f).length !== 2 || inchidere(f)?.p_stare !== 'incheiata' || inchidere(f)?.p_loturi !== 1 || inchidere(f)?.p_loturi_sarite !== 1) return `P0001: ${inchidere(f)?.p_stare} loturi ${inchidere(f)?.p_loturi}/${inchidere(f)?.p_loturi_sarite}`
    // eroare necunoscută la scriere → oprire (L05: nimic dovedit)
    const g = lume({ loturi: [lot(L1, 2), lot(L2, 2, { baza: 7100000000 })], scrie: () => ({ error: { message: 'retea' } }) })
    await M.ruleazaUrmarireAuto(CRON, g.deps)
    if (tracking(g).length !== 1 || inchidere(g)?.p_eroare_cod !== 'scriere_neconfirmata') return 'scrierea neconfirmată nu oprește rularea'
    // rularea închisă între timp (RD041) → oprire
    const h = lume({ scrie: () => ({ error: { code: 'RD041' } }) })
    await M.ruleazaUrmarireAuto(CRON, h.deps)
    if (inchidere(h)?.p_stare !== 'oprita_eroare') return 'RD041 nu oprește rularea'
    return null
  },
  async suprapunere(M) {
    for (const motiv of ['rulare_in_curs', 'slot_rulat', 'plafon_manual_zi']) {
      const f = lume({ start: { ocupat: true, motiv } })
      const r = await M.ruleazaUrmarireAuto(CRON, f.deps)
      if (r.status !== 200 || r.body.cod !== 'rulare_ocupata' || f.rpc.length !== 1 || f.fetchuri.length) return `ocupat (${motiv}): ${r.body.cod}, ${f.rpc.length} RPC, ${f.fetchuri.length} apeluri FAN`
    }
    const e = lume({ start: () => ({ error: { code: '42501' } }) })
    const r = await e.deps && await M.ruleazaUrmarireAuto(CRON, e.deps)
    if (r.status !== 503 || e.rpc.length !== 1 || e.fetchuri.length) return 'revendicarea refuzată nu oprește tot'
    const x = lume({ start: { rulare_id: RUL, plafon_apeluri: 999 } })
    if ((await M.ruleazaUrmarireAuto(CRON, x.deps)).status !== 503 || x.fetchuri.length) return 'un plafon peste cel din cod e acceptat'
    return null
  },
  async gardaTest(M) {
    // selecția din BD nu ar trebui să dea un lot real, dar dacă îl dă (defect), codul îl sare înaintea oricărui apel (aceeași gardă ca butonul)
    const f = lume({ loturi: [lot(LR, 2, { proiect_cod: 'LOT1-REAL', test: false }), lot(L2, 1, { proiect_cod: 'TEST-RAZVAN', test: false }), lot(L1, 1)] })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    const lot_ = f.rpc.filter(x => x.nume === 'fn_red_fan_srv_urmarire').map(x => x.args.p_lot_id)
    if (JSON.stringify(lot_) !== JSON.stringify([L1]) || tracking(f).length !== 1 || inchidere(f)?.p_loturi_sarite !== 2) return `lotul real / nemarcat a ajuns la curier: ${lot_.join(',')}`
    return null
  },
  async faraSecrete(M) {
    const f = lume({ secrete: null })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    if (f.fetchuri.length || inchidere(f)?.p_eroare_cod !== 'transport_neconfigurat') return 'fără secrete: s-a cerut curierului sau codul e altul'
    const g = lume({ loturi: () => ({ error: { message: 'x' } }) })
    let cit = false; g.deps.secrete = () => { cit = true; return { username: 'u', password: 'p', clientId: '7' } }
    await M.ruleazaUrmarireAuto(CRON, g.deps)
    if (cit || g.fetchuri.length || inchidere(g)?.p_eroare_cod !== 'selectie_neconfirmata') return 'selecția picată: secretele citite / curier chemat'
    const h = lume({ loturi: [] })
    let cit2 = false; h.deps.secrete = () => { cit2 = true; return null }
    await M.ruleazaUrmarireAuto(CRON, h.deps)
    if (cit2 || h.fetchuri.length || inchidere(h)?.p_stare !== 'incheiata') return 'nimic de urmărit: secretele citite / curier chemat'
    return null
  },
  async raspunsFaraDate(M) {
    const f = lume({ loturi: [lot(L1, 3)] })
    const r = await M.ruleazaUrmarireAuto(CRON, f.deps)
    const t = JSON.stringify(r.body)
    if (/7000000001|tok|"u"|PERSOANA/.test(t)) return 'răspunsul conține AWB / token / date'
    return null
  },
  async owner(M) {
    const f = lume()
    await M.ruleazaUrmarireAuto({ sursa: 'owner', actor: OWNER }, f.deps)
    const s = f.rpc[0]
    if (s?.nume !== 'fn_red_fan_srv_rulare_incepe' || s.args.p_sursa !== 'owner' || s.args.p_actor !== OWNER) return 'pornirea owner-ului nu trimite actorul'
    const g = lume()
    await M.ruleazaUrmarireAuto(CRON, g.deps)
    if (g.rpc[0].args.p_actor !== null || g.rpc[0].args.p_sursa !== 'cron') return 'cronul trimite un actor'
    return null
  },
}

describe('urmărirea automată (redari-fan-urmarire): codul real trece toate verificările', () => {
  for (const [nume, v] of Object.entries(VERIFICARI)) it(nume, async () => { expect(await v(REAL)).toBeNull() })
})

describe('funcția edge redari-fan-urmarire: poarta ÎNAINTEA oricărei citiri, corpul ignorat', () => {
  const SRC = readFileSync('supabase/functions/redari-fan-urmarire/index.ts', 'utf8').replace(/\r/g, '')
  it('cronSauOwner (x-intern-secret din Vault / owner logat) e prima decizie; fără ea = 401', () => {
    const iPoarta = SRC.indexOf('const cine = await cronSauOwner(req, sb)'), i401 = SRC.indexOf("if (!cine) return json({ cod: 'neautorizat' }, 401)")
    const iRulare = SRC.indexOf('await ruleazaUrmarireAuto(')
    expect(iPoarta).toBeGreaterThan(0); expect(i401).toBeGreaterThan(iPoarta); expect(iRulare).toBeGreaterThan(i401)
    expect(SRC).toMatch(/import \{ cronSauOwner \} from '\.\.\/_shared\/poartaCron\.ts'/)
    // între createClient și poartă: nimic citit (fără rpc / from / fetch / env-urile FAN)
    const inainte = SRC.slice(SRC.indexOf('Deno.serve('), iPoarta)
    expect(inainte).not.toMatch(/\.rpc\(|\.from\(|fetch\(|FAN_/)
  })
  it('corpul cererii nu se citește; actorul owner-ului vine din JWT-ul verificat, nu din cerere', () => {
    expect(SRC).not.toMatch(/req\.json\(|req\.text\(|searchParams/)
    expect(SRC).toMatch(/actor = data\.user\.id/)
  })
  it('funcția edge NU e în lista NO_JWT (verify_jwt rămâne pornit, ca jobul 29; poarta din cod e cea care decide)', () => {
    const wf = readFileSync('.github/workflows/deploy-edge-function.yml', 'utf8')
    const linie = wf.split('\n').find(l => /^\s*NO_JWT="/.test(l)) || ''
    expect(linie).not.toContain(' redari-fan-urmarire ')
  })
})

describe('regula contradicțiilor în ACELAȘI răspuns (spec §9.2, precondiția F2) — rezumatUrmarireFan', () => {
  const ev = (...e) => ({ events: e.map(([id, date]) => ({ id, date })) })
  it.each([
    ['două C0 în zile diferite → de verificat, fără dată propusă', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-19 09:00:00']), { urmarire_stare: 'de_verificat', ridicat_propus: null }],
    ['două C0 în aceeași zi, ore diferite → ridicat cu ziua', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-18 15:00:00']), { urmarire_stare: 'ridicat', ridicat_propus: '2026-11-18' }],
    ['C0 + S2 → livrat', ev(['C0', '2026-11-18 10:00:00'], ['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat', ridicat_propus: '2026-11-18', livrat_la: '2026-11-20 10:40:00' }],
    ['S2 + S16 → de verificat, fără livrare / retur propuse', ev(['S2', '2026-11-20 10:40:00'], ['S16', '2026-11-21 10:00:00']), { urmarire_stare: 'de_verificat', livrat_la: null, retur_propus: null }],
    ['S2 fără C0 → livrat, ridicarea necunoscută', ev(['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat', ridicat_propus: null, livrat_la: '2026-11-20 10:40:00' }],
    ['două S2 la ore diferite → de verificat, fără oră propusă', ev(['S2', '2026-11-20 10:40:00'], ['S2', '2026-11-20 12:00:00']), { urmarire_stare: 'de_verificat', livrat_la: null }],
    ['evenimente identice repetate = un singur fapt', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-18 10:00:00'], ['S2', '2026-11-20 10:40:00'], ['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat', ridicat_propus: '2026-11-18' }],
    ['adresă greșită, apoi livrat → livrat (nu e retur)', ev(['S4', '2026-11-19 10:00:00'], ['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat' }],
  ])('%s', (_, el, asteptat) => { expect(rezumatUrmarireFan(el)).toMatchObject(asteptat) })
  it('livrare + returnAwbNumber → de verificat', () => {
    expect(rezumatUrmarireFan({ ...ev(['S2', '2026-11-20 10:40:00']), returnAwbNumber: '1000000999' })).toMatchObject({ urmarire_stare: 'de_verificat', livrat_la: null })
  })
})

describe('butonul „Urmărire” (F1) neschimbat: p_actor = omul, p_rulare NULL, fără pasul plafonului', () => {
  it('executaActiuneFan „urmarire” scrie cu clasa B, p_actor = uid', async () => {
    const UID = 'f0000000-0000-4000-8000-000000000001'
    const scrieri = []
    const deps = {
      secrete: () => ({ username: 'u', password: 'p', clientId: '7' }),
      fetch: async (url, init = {}) => (new URL(url).pathname === '/login' ? json(200, { data: { token: 't' } }) : urmarireOk(url, init)),
      randuriLot: async () => ({ data: [{ id: rid(L1, 1), plic_id: 'p', nr_plic: 'PL-TST-0001', stare: 'generat', awb: '7000000001', versiune_urmarire: 1 }] }),
      rpcServer: async (n, a) => { scrieri.push({ n, a }); return { data: { scrise: 1, pastrate: 0, depasite: 0 } } },
      pauza: async () => {},
    }
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire', lot_id: L1 }, lot: { id: L1 }, uid: UID }, deps)
    expect(r.status).toBe(200)
    expect(scrieri).toEqual([{ n: 'fn_red_fan_srv_urmarire', a: expect.objectContaining({ p_actor: UID, p_rulare: null, p_lot_id: L1 }) }])
  })
})

// ── mutanți: modulele copiate într-un folder temporar, cu o singură mutație; cel puțin o verificare trebuie să PICE ──
const SURSE = Object.fromEntries(['redariFan.mjs', 'redariFanTransport.mjs', 'redariFanHandler.mjs', 'redariFanUrmarireAuto.mjs']
  .map(n => [n, readFileSync(join('supabase/functions/_shared', n), 'utf8')]))
// sub .tmp/ din depozit (ignorat de git), ca în fanCourierMutanti.test.js: calea scurtă a folderului temporar Windows (GAZPET~1) nu se importă prin vite
mkdirSync(join(process.cwd(), '.tmp'), { recursive: true })
const DIR = mkdtempSync(join(process.cwd(), '.tmp', 'fan_auto_mut_'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
let nrMutant = 0
async function cuMutatie(fisier, din, in_) {
  const s = { ...SURSE }
  const parti = s[fisier].split(din)
  if (parti.length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${fisier}: ${din.slice(0, 80)}`)
  s[fisier] = parti.join(in_)
  const d = join(DIR, 'm' + (++nrMutant))
  mkdirSync(d, { recursive: true })
  for (const [n, t] of Object.entries(s)) writeFileSync(join(d, n), t)
  return import(pathToFileURL(join(d, 'redariFanUrmarireAuto.mjs')).href)
}
const MUTANTI = [
  ['poarta: orice apelant acceptat', 'redariFanUrmarireAuto.mjs', "if (!['cron', 'owner'].includes(sursa)) return out(401, 'neautorizat')", "if (false) return out(401, 'neautorizat')"],
  ['poarta: owner fără actor verificat', 'redariFanUrmarireAuto.mjs', "if (sursa === 'owner' && !(typeof apelant.actor === 'string' && UUID.test(apelant.actor))) return out(401, 'neautorizat')", ''],
  ['garda de fetch: orice cale permisă', 'redariFanUrmarireAuto.mjs', "return APELURI_FAN_RULARE.some(([mm, cc]) => mm === m && cc === cale) ? cale : null", 'return cale'],
  ['garda de fetch: compară prefixul, nu calea exactă', 'redariFanUrmarireAuto.mjs', 'mm === m && cc === cale', 'mm === m && cale.startsWith(cc)'],
  ['plafonul: pasul BD-ului înaintea GET-ului scos (transport)', 'redariFanTransport.mjs', "    if (typeof deps.inainteDeApel === 'function') {", '    if (false) {'],
  ['plafonul local scos', 'redariFanUrmarireAuto.mjs', "    if (apeluri >= plafon) return { ok: false, cod: 'plafon_local' }\n", ''],
  ['bugetul de timp scos', 'redariFanUrmarireAuto.mjs', "    if (deps.acum() - t0 > BUGET_RULARE_MS) return { ok: false, cod: 'buget_timp' }\n", ''],
  ['eroarea curierului nu oprește rularea', 'redariFanUrmarireAuto.mjs', "      if (r.status === 502) return incheie(", "      if (r.status === 502) { sarite++; continue }\n      if (false) return incheie("],
  ['scrierea cu p_actor (ramura butonului) în loc de p_rulare', 'redariFanTransport.mjs', '  if (rulare) return typeof deps.rpcServer', '  if (false) return typeof deps.rpcServer'],
  ['garda doar TEST din cod scoasă', 'redariFanUrmarireAuto.mjs', "if (ok && transportPermis({ proiectCod: l.proiect_cod ?? null, fanLot: { test: l.test === true }, cereMarcaj: true }).ok) deUrmarit.push(l)", 'if (ok) deUrmarit.push(l)'],
  ['„ocupat” ignorat (rulări suprapuse)', 'redariFanUrmarireAuto.mjs', "if (d0 && typeof d0 === 'object' && d0.ocupat === true) return out(200, 'rulare_ocupata'", "if (false) return out(200, 'rulare_ocupata'"],
  ['plafonul din BD neverificat', 'redariFanUrmarireAuto.mjs', ' || plafon > PLAFON_APELURI_RULARE)', ')'],
  ['secretele citite înaintea selecției', 'redariFanUrmarireAuto.mjs', "  const sel = await rpc('fn_red_fan_srv_de_urmarit', { p_rulare: rulare })", "  deps.secrete()\n  const sel = await rpc('fn_red_fan_srv_de_urmarit', { p_rulare: rulare })"],
  ['refuzul determinist de lot oprește tot', 'redariFanUrmarireAuto.mjs', "const REFUZ_LOT = ['P0001', 'RD032', '22023']", 'const REFUZ_LOT = []'],
  ['refuzul NEcunoscut de lot sărit (L05)', 'redariFanUrmarireAuto.mjs', "      return incheie('oprita_eroare', 'scriere_neconfirmata')\n", "      sarite++; continue\n"],
  ['contradicția C0 (două zile) nu mai e prinsă', 'redariFan.mjs', "  if (distincte('ridicat', 'data') > 1) return rez(", "  if (false) return rez("],
]
describe('mutanți (fiecare trebuie să pice cel puțin o verificare)', () => {
  it.each(MUTANTI)('%s', async (_, fisier, din, in_) => {
    const M = await cuMutatie(fisier, din, in_)
    const picate = []
    for (const [nume, v] of Object.entries(VERIFICARI)) { let e; try { e = await v(M) } catch (x) { e = 'excepție: ' + x.message } if (e) picate.push(nume + ': ' + e) }
    if (fisier === 'redariFan.mjs') {
      const { rezumatUrmarireFan: rz } = await import(pathToFileURL(join(DIR, 'm' + nrMutant, 'redariFan.mjs')).href)
      if (rz({ events: [{ id: 'C0', date: '2026-11-18 10:00:00' }, { id: 'C0', date: '2026-11-19 09:00:00' }] }).urmarire_stare !== 'de_verificat') picate.push('contradicții: două C0 nu dau de_verificat')
    }
    expect(picate.length, 'mutantul a trecut toate verificările').toBeGreaterThan(0)
  })
})
