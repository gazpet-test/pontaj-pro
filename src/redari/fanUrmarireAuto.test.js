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
import * as AUTO_REAL from '../../supabase/functions/_shared/redariFanUrmarireAuto.mjs'
import * as TRANSPORT_REAL from '../../supabase/functions/_shared/redariFanTransport.mjs'
import * as FAN_REAL from '../../supabase/functions/_shared/redariFan.mjs'
import { rezumatUrmarireFan, interpreteazaUrmarire, URL_FAN, REGULI_CONTRADICTII } from '../../supabase/functions/_shared/redariFan.mjs'
import { executaActiuneFan, PAUZA_INTRE_CERERI_MS } from '../../supabase/functions/_shared/redariFanTransport.mjs'
// modulul verificat = rularea + transportul + helperul din ACELAȘI folder (codul real sau copia mutată)
const REAL = { ...AUTO_REAL, __transport: TRANSPORT_REAL, __fan: FAN_REAL }

const RUL = '0a000000-0000-4000-8000-000000000001'
const OWNER = '00000000-0000-4000-8000-000000000001'
const L1 = '20000000-0000-4000-8000-000000000001', L2 = '20000000-0000-4000-8000-000000000002', LR = '20000000-0000-4000-8000-000000000004'
const rid = (l, i) => `${l.slice(0, 2)}a00000-0000-4000-8000-${String(i).padStart(12, '0')}`
// runda 5: fiecare rând poartă ziua generării (reperul momentului posibil), ca fn_red_fan_srv_de_urmarit / COL_FAN
const GEN_LA = '2026-11-15T08:00:00.123456+00:00'
// ceasul probei: 21.11.2026 09:00 UTC (11:00 ora României); diferențele (bugetul de timp) rămân cele din `timp`
const T_ACUM = Date.parse('2026-11-21T09:00:00Z')
const randuri = (l, n, baza = 7000000000) => Array.from({ length: n }, (_, i) => ({ id: rid(l, i + 1), awb: String(baza + i + 1), stare: 'generat', versiune_urmarire: 3, generat_la: GEN_LA }))
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
    acum: () => T_ACUM + (timp ? timp(t++) : 0),
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
    // runda 2 (Jakarinos #1155 r1 P2, doc §4 pasul 6): forma necunoscută a ÎNTREGULUI răspuns = eroare de schemă → oprire „oprita_eroare”,
    // NIMIC scris, al doilea lot nu mai e cerut (reproducerea recenzentului: două loturi, `{ ceva: 1 }`)
    for (const corp of [{ ceva: 1 }, { data: [{ foo: 1 }, { bar: 2 }] }, 'text']) {
      const u = lume({ loturi: [lot(L1, 2), lot(L2, 2, { baza: 7100000000 })], fanRaspuns: () => json(200, corp) })
      const r = await M.ruleazaUrmarireAuto(CRON, u.deps)
      if (tracking(u).length !== 1 || u.rpc.some(x => x.nume === 'fn_red_fan_srv_urmarire') || inchidere(u)?.p_stare !== 'oprita_eroare'
          || inchidere(u)?.p_eroare_cod !== 'fan_forma_necunoscuta' || r.body.cod !== 'oprita')
        return `forma necunoscută ${JSON.stringify(corp)}: ${tracking(u).length} GET, ${u.rpc.filter(x => x.nume === 'fn_red_fan_srv_urmarire').length} scrieri, ${inchidere(u)?.p_stare}/${inchidere(u)?.p_eroare_cod}`
    }
    // un ELEMENT anume (AWB absent din răspuns) rămâne „de verificat” pe acel AWB, rularea continuă (nu e eroare de schemă)
    const e = lume({ loturi: [lot(L1, 2)], fanRaspuns: () => json(200, { data: [{ awbNumber: '7000000001', events: [{ id: 'C0', date: '2026-11-20 10:40:00' }] }] }) })
    await M.ruleazaUrmarireAuto(CRON, e.deps)
    const s = e.rpc.find(x => x.nume === 'fn_red_fan_srv_urmarire')
    if (!s || s.args.p_randuri.map(x => x.urmarire_stare).join() !== 'ridicat,de_verificat' || inchidere(e)?.p_stare !== 'incheiata') return 'AWB-ul absent dintr-un răspuns valid nu e „de verificat” sau rularea s-a oprit'
    return null
  },
  async reautentificare(M) {
    // runda 2 (Jakarinos #1155 r1 P2): curierul cere login din nou (401) → reluarea GET-ului trece PRIN pasul plafonului, cu pauză
    const de401 = () => { let n = 0; return url => (++n === 1 ? json(401, null) : urmarireOk(url)) }
    // plafon 1: primul GET consumă plafonul, reluarea e refuzată local → UN singur GET efectiv, nimic scris, „oprita_plafon”
    const f = lume({ start: { rulare_id: RUL, plafon_apeluri: 1 }, fanRaspuns: de401() })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    const login = f.fetchuri.filter(x => x.cale === '/login').length
    if (tracking(f).length !== 1 || f.rpc.filter(x => x.nume === 'fn_red_fan_srv_rulare_apel').length !== 1 || inchidere(f)?.p_stare !== 'oprita_plafon'
        || inchidere(f)?.p_eroare_cod !== 'plafon_local' || f.rpc.some(x => x.nume === 'fn_red_fan_srv_urmarire'))
      return `plafon 1 cu 401: ${tracking(f).length} GET, ${login} login, ${f.rpc.filter(x => x.nume === 'fn_red_fan_srv_rulare_apel').length} pași, ${inchidere(f)?.p_stare}/${inchidere(f)?.p_eroare_cod}`
    // refuzul BD-ului pe pasul reluării (RD040) → la fel: nimic trimis după el
    const g = lume({ fanRaspuns: de401(), apel: n => (n <= 1 ? { data: n } : { error: { code: 'RD040' } }) })
    await M.ruleazaUrmarireAuto(CRON, g.deps)
    if (tracking(g).length !== 1 || inchidere(g)?.p_eroare_cod !== 'rd040') return `RD040 pe reluare: ${tracking(g).length} GET, ${inchidere(g)?.p_eroare_cod}`
    // plafon 20: reluarea are loc, FIECARE GET e precedat de pasul lui și reluarea de pauză; contorul = GET-urile efective
    const h = lume({ fanRaspuns: de401() })
    const r = await M.ruleazaUrmarireAuto(CRON, h.deps)
    const j = h.jurnal
    const iGet = j.map((x, i) => (x === 'fetch:GET /reports/awb/tracking' ? i : -1)).filter(i => i >= 0)
    const pasi = h.rpc.filter(x => x.nume === 'fn_red_fan_srv_rulare_apel').length
    if (iGet.length !== 2 || pasi !== 2 || r.body.apeluri !== 2 || j[iGet[1] - 1] !== 'rpc:fn_red_fan_srv_rulare_apel' || j[iGet[1] - 2] !== 'pauza:' + PAUZA_INTRE_CERERI_MS
        || inchidere(h)?.p_stare !== 'incheiata')
      return `reluarea după 401: ${iGet.length} GET, ${pasi} pași, apeluri raportate ${r.body.apeluri}, înainte de reluare: ${j[iGet[1] - 2]} / ${j[iGet[1] - 1]}`
    // bugetul de timp e verificat și pe reluare
    const b = lume({ fanRaspuns: de401(), timp: i => (i <= 1 ? 0 : REAL.BUGET_RULARE_MS + 1) })
    await M.ruleazaUrmarireAuto(CRON, b.deps)
    if (tracking(b).length !== 1 || inchidere(b)?.p_eroare_cod !== 'buget_timp') return `bugetul pe reluare: ${tracking(b).length} GET, ${inchidere(b)?.p_eroare_cod}`
    return null
  },
  async payloadFapte(M) {
    // rândurile trimise în BD poartă faptele REZOLVATE + contradicțiile din același răspuns (BD-ul le păstrează durabil): două C0 + S2 + S16
    const f = lume({ loturi: [lot(L1, 1)], fanRaspuns: () => json(200, { data: [{ awbNumber: '7000000001', events: [{ id: 'C0', date: '2026-11-18 10:00:00' },
      { id: 'C0', date: '2026-11-19 09:00:00' }, { id: 'S2', date: '2026-11-20 10:40:00' }, { id: 'S16', date: '2026-11-21 10:00:00' }] }] }) })
    await M.ruleazaUrmarireAuto(CRON, f.deps)
    const p = f.rpc.find(x => x.nume === 'fn_red_fan_srv_urmarire')?.args.p_randuri?.[0]
    if (!p || p.urmarire_stare !== 'retur' || p.ridicat_propus !== '2026-11-18' || p.livrat_la !== null || p.retur_la !== '2026-11-21 10:00:00'
        || JSON.stringify((p.contradictii || []).map(c => c.tip)) !== JSON.stringify(['ridicare_zile', 'livrare_retur']))
      return 'rândul trimis în BD nu poartă faptele rezolvate / contradicțiile: ' + JSON.stringify(p)
    return null
  },
  async rulareFaraPlafon(M) {
    // apărare în adâncime: urmaresteLot pe o rulare cu un client FĂRĂ pasul plafonului → refuz înaintea oricărui GET
    const urm = M.__transport?.urmaresteLot
    if (!urm) return 'nu găsesc urmaresteLot'
    const fetchuri = []
    const fan = M.__transport.clientFan({ fetch: async url => { fetchuri.push(url); return json(200, { data: { token: 't' } }) }, secrete: { username: 'u', password: 'p', clientId: '7' } })
    const r = await urm({ lot: { id: L1 }, randuri: randuri(L1, 2), s: { clientId: '7' }, fan, deps: { rpcServer: async () => ({ data: { scrise: 2, pastrate: 0, depasite: 0 } }), pauza: async () => {} },
      rulare: RUL, out: (status, cod, extra = {}) => ({ status, body: { cod, ...extra } }) })
    if (r.status !== 423 || r.body.cod_bd !== 'fara_plafon' || fetchuri.length) return `rulare cu client fără plafon: ${r.status} ${r.body.cod_bd}, ${fetchuri.length} apeluri`
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

// ── regula contradicțiilor (decizia owner-ului 21.11.2026, runda 2): tabel de cazuri cu așteptări scrise de mână din FAN_URMARIRE_AUTOMATA.md §3b (L25) ──
const ev = (...e) => ({ events: e.map(([id, date]) => ({ id, date })) })
const CR = REGULI_CONTRADICTII
// runda 5: reperul de timp (obligatoriu) al probelor de REGULĂ de mai jos = larg (generat 01.08, procesat 31.12.2026), ca toate datele cazurilor să fie
// posibile; regula momentului posibil are tabelul ei (VERIFICARI.momentPosibil). Construit cu funcția MODULULUI (o mutație în ea se vede și aici).
const REPER_LARG = F => F.reperUrmarireFan({ generatLa: '2026-08-01T00:00:00Z', acumMs: Date.parse('2026-12-31T00:00:00Z') })
const cuReper = F => el => F.rezumatUrmarireFan(el, REPER_LARG(F))
const urmCuReper = F => (s, c, awbs) => F.interpreteazaUrmarire(s, c, awbs, new Map((awbs || []).map(a => [a, REPER_LARG(F)])))
const rzT = cuReper(FAN_REAL)
const CAZURI_CONTRADICTII = [
  ['reproducerea Jakarinos P1: două C0 (zile diferite), două S2 (ore diferite) și S16 → TOATE trei evaluate, faptele după regulă',
    ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-19 09:00:00'], ['S2', '2026-11-20 10:40:00'], ['S2', '2026-11-20 12:00:00'], ['S16', '2026-11-21 10:00:00']),
    { urmarire_stare: 'retur', ridicat_propus: '2026-11-18', livrat_la: null, retur_la: '2026-11-21 10:00:00' },
    [['ridicare_zile', '2026-11-18', ['2026-11-18', '2026-11-19']], ['livrare_ore', '2026-11-20 12:00:00', ['2026-11-20 10:40:00', '2026-11-20 12:00:00']],
      ['livrare_retur', 'retur', ['S2 2026-11-20 12:00:00', 'S16 2026-11-21 10:00:00']]]],
  ['două C0 în zile diferite → ridicat, PRIMA zi', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-19 09:00:00']),
    { urmarire_stare: 'ridicat', ridicat_propus: '2026-11-18' }, [['ridicare_zile', '2026-11-18', ['2026-11-18', '2026-11-19']]]],
  ['două C0 în aceeași zi, ore diferite → ridicat cu ziua, fără contradicție', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-18 15:00:00']),
    { urmarire_stare: 'ridicat', ridicat_propus: '2026-11-18' }, []],
  ['C0 + S2 → livrat', ev(['C0', '2026-11-18 10:00:00'], ['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat', ridicat_propus: '2026-11-18', livrat_la: '2026-11-20 10:40:00' }, []],
  ['S2, apoi S16 → retur după livrare = retur', ev(['S2', '2026-11-20 10:40:00'], ['S16', '2026-11-21 10:00:00']),
    { urmarire_stare: 'retur', livrat_la: null, retur_propus: null, retur_la: '2026-11-21 10:00:00' }, [['livrare_retur', 'retur', ['S2 2026-11-20 10:40:00', 'S16 2026-11-21 10:00:00']]]],
  ['S16, apoi S2 → livrarea ulterioară câștigă', ev(['S16', '2026-11-20 10:00:00'], ['S2', '2026-11-21 10:40:00']),
    { urmarire_stare: 'livrat', livrat_la: '2026-11-21 10:40:00', retur_propus: null, retur_la: null }, [['livrare_retur', 'livrat', ['S2 2026-11-21 10:40:00', 'S16 2026-11-20 10:00:00']]]],
  ['S2 și S16 la aceeași oră → retur (egalitatea merge la retur)', ev(['S2', '2026-11-20 10:40:00'], ['S16', '2026-11-20 10:40:00']),
    { urmarire_stare: 'retur', livrat_la: null }, [['livrare_retur', 'retur', ['S2 2026-11-20 10:40:00', 'S16 2026-11-20 10:40:00']]]],
  ['S2 + returnAwbNumber (fără oră) → retur', { ...ev(['S2', '2026-11-20 10:40:00']), returnAwbNumber: '1000000999' },
    { urmarire_stare: 'retur', livrat_la: null, retur_la: null }, [['livrare_retur', 'retur', ['S2 2026-11-20 10:40:00', 'returnAwbNumber']]]],
  ['două S2 la ore diferite → livrat, ULTIMA oră', ev(['S2', '2026-11-20 10:40:00'], ['S2', '2026-11-20 12:00:00']),
    { urmarire_stare: 'livrat', livrat_la: '2026-11-20 12:00:00' }, [['livrare_ore', '2026-11-20 12:00:00', ['2026-11-20 10:40:00', '2026-11-20 12:00:00']]]],
  ['S2, apoi refuz (S6) ca ultim eveniment → retur „refuz”', ev(['S2', '2026-11-20 10:40:00'], ['S6', '2026-11-20 15:00:00']),
    { urmarire_stare: 'retur', livrat_la: null, retur_propus: 'refuz', retur_la: '2026-11-20 15:00:00' }, [['livrare_retur', 'retur', ['S2 2026-11-20 10:40:00', 'S6 2026-11-20 15:00:00']]]],
  ['evenimente identice repetate = un singur fapt', ev(['C0', '2026-11-18 10:00:00'], ['C0', '2026-11-18 10:00:00'], ['S2', '2026-11-20 10:40:00'], ['S2', '2026-11-20 10:40:00']),
    { urmarire_stare: 'livrat', ridicat_propus: '2026-11-18', livrat_la: '2026-11-20 10:40:00' }, []],
  ['adresă greșită, apoi livrat → livrat, fără contradicție', ev(['S4', '2026-11-19 10:00:00'], ['S2', '2026-11-20 10:40:00']), { urmarire_stare: 'livrat', retur_propus: null }, []],
  ['un eveniment de formă necunoscută → de verificat, NICIUN fapt (cronologia incompletă)', { events: [{ id: 'C0', date: '2026-11-18 10:00:00' }, { id: 'C0', date: '18.11.2026' }, { id: 'S2', date: '2026-11-20 10:40:00' }] },
    { urmarire_stare: 'de_verificat', ridicat_propus: null, livrat_la: null, retur_propus: null, ultim_eveniment: 'S2' }, []],
  // runda 3 (Jakarinos #1155 r2 P1): reproducerea recenzentului, în ordinea care dădea „livrat” fără contradicție
  ['[S6, S2] la aceeași oră (ordinea care dădea „livrat”) → retur „refuz”, cu contradicția', ev(['S6', '2026-11-20 10:00:00'], ['S2', '2026-11-20 10:00:00']),
    { urmarire_stare: 'retur', livrat_la: null, retur_propus: 'refuz', retur_la: '2026-11-20 10:00:00', ultim_eveniment: 'S6' },
    [['livrare_retur', 'retur', ['S2 2026-11-20 10:00:00', 'S6 2026-11-20 10:00:00']]]],
  ['refuz și adresă greșită la aceeași oră → motivul refuz (departajarea), contradicția retur_motiv', ev(['S6', '2026-11-20 10:00:00'], ['S4', '2026-11-20 10:00:00']),
    { urmarire_stare: 'retur', retur_propus: 'refuz', ultim_eveniment: 'S6' }, [['retur_motiv', 'refuz', ['adresa_incompleta', 'refuz']]]],
]
// ── runda 3 P1: aceleași evenimente în ORICE ordine dau același rezultat (toate permutările), cu așteptările scrise de mână (L25) ──
const T_ = '2026-11-20 10:00:00', T0_ = '2026-11-19 09:00:00'
const CAZURI_EGALITATE = [
  ['S2 + S6 la aceeași oră (reproducerea r2)', [['S2', T_], ['S6', T_]],
    { urmarire_stare: 'retur', ultim_eveniment: 'S6', livrat_la: null, retur_propus: 'refuz', retur_la: T_ }, [['livrare_retur', 'retur', [`S2 ${T_}`, `S6 ${T_}`]]]],
  ['C0, apoi S2 + S4 + S6 la aceeași oră', [['C0', T0_], ['S2', T_], ['S4', T_], ['S6', T_]],
    { urmarire_stare: 'retur', ultim_eveniment: 'S6', ridicat_propus: '2026-11-19', retur_propus: 'refuz', retur_la: T_ },
    [['livrare_retur', 'retur', [`S2 ${T_}`, `S6 ${T_}`]], ['retur_motiv', 'refuz', ['adresa_incompleta', 'refuz']]]],
  ['S2 + S99 la aceeași oră → de verificat (faptul livrării păstrat)', [['S2', T_], ['S99', T_]],
    { urmarire_stare: 'de_verificat', ultim_eveniment: 'S99', livrat_la: T_ }, []],
  ['C0 + H3 + S98 la aceeași oră → ridicat, ultimul eveniment C0', [['C0', T_], ['H3', T_], ['S98', T_]],
    { urmarire_stare: 'ridicat', ultim_eveniment: 'C0', ridicat_propus: '2026-11-20' }, []],
  ['S2 + S16 + S6 la aceeași oră → retur, codul returului S16, motivul refuz', [['S2', T_], ['S16', T_], ['S6', T_]],
    { urmarire_stare: 'retur', ultim_eveniment: 'S16', retur_propus: 'refuz', retur_la: T_ }, [['livrare_retur', 'retur', [`S2 ${T_}`, `S16 ${T_}`]]]],
  ['două S2 + S50 la ora a doua → de verificat (S50), ultima oră de livrare', [['S2', T0_], ['S2', T_], ['S50', T_]],
    { urmarire_stare: 'de_verificat', ultim_eveniment: 'S50', livrat_la: T_ }, [['livrare_ore', T_, [T0_, T_]]]],
  ['S6 + S2 + cod necunoscut X7 la aceeași oră → retur (retururile la capăt)', [['S6', T_], ['S2', T_], ['X7', T_]],
    { urmarire_stare: 'retur', ultim_eveniment: 'S6', retur_propus: 'refuz' }, [['livrare_retur', 'retur', [`S2 ${T_}`, `S6 ${T_}`]]]],
  ['S2 + X7 la aceeași oră → de verificat (codul necunoscut, oriunde ar sta)', [['X7', T_], ['S2', T_]],
    { urmarire_stare: 'de_verificat', ultim_eveniment: 'X7', livrat_la: T_ }, []],
  ['șase evenimente (C0 + H3 la ora 1; S2, S6, S4, S16 la ora 2), 720 de ordini', [['C0', T0_], ['H3', T0_], ['S2', T_], ['S6', T_], ['S4', T_], ['S16', T_]],
    { urmarire_stare: 'retur', ultim_eveniment: 'S16', ridicat_propus: '2026-11-19', livrat_la: null, retur_propus: 'refuz', retur_la: T_ },
    [['livrare_retur', 'retur', [`S2 ${T_}`, `S16 ${T_}`]], ['retur_motiv', 'refuz', ['adresa_incompleta', 'refuz']]]],
]
const permutari = a => (a.length <= 1 ? [a] : a.flatMap((x, i) => permutari([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p])))
const verificaEgalitate = rz => {
  for (const [nume, evs, fapte, contr] of CAZURI_EGALITATE) {
    let primul = null
    for (const p of permutari(evs)) {
      const r = rz(ev(...p)), s = JSON.stringify(r)
      if (primul === null) primul = s
      else if (s !== primul) return `${nume}: ordinea ${p.map(e => e[0]).join(',')} dă alt rezultat: ${s} față de ${primul}`
      for (const [k, v] of Object.entries(fapte)) if (r[k] !== v) return `${nume} (ordinea ${p.map(e => e[0]).join(',')}): ${k} = ${JSON.stringify(r[k])}, așteptat ${JSON.stringify(v)}`
      const c = JSON.stringify(r.contradictii.map(x => [x.tip, x.ales, x.valori, x.regula])), a = JSON.stringify(contr.map(([t, al, v]) => [t, al, v, CR[t]]))
      if (c !== a) return `${nume} (ordinea ${p.map(e => e[0]).join(',')}): contradicții ${c}, așteptat ${a}`
    }
  }
  return null
}
// ── runda 3 P2: limita COMUNĂ a valorilor (50, = BD) — 50 trec cu toate valorile; 51 = „de verificat” fără fapte; bucata mixtă ──
const oreS2 = n => Array.from({ length: n }, (_, i) => ['S2', `2026-11-20 ${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`])
const zileC0 = n => Array.from({ length: n }, (_, i) => ['C0', new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10) + ' 10:00:00'])
const verificaLimita = F => {
  const rz = cuReper(F)
  const r50 = rz(ev(...oreS2(50))), r51 = rz(ev(...oreS2(51)))
  if (r50.urmarire_stare !== 'livrat' || r50.contradictii.length !== 1 || r50.contradictii[0].valori.length !== 50 || r50.livrat_la !== '2026-11-20 08:49:00') return '50 de ore S2: ' + JSON.stringify(r50).slice(0, 200)
  if (r51.urmarire_stare !== 'de_verificat' || r51.contradictii.length || r51.livrat_la !== null || !/51/.test(r51.motiv || '') || !/limita 50/.test(r51.motiv || '')) return '51 de ore S2: ' + JSON.stringify(r51).slice(0, 200)
  const z50 = rz(ev(...zileC0(50))), z51 = rz(ev(...zileC0(51)))
  if (z50.urmarire_stare !== 'ridicat' || z50.ridicat_propus !== '2026-09-01' || z50.contradictii[0]?.valori.length !== 50) return '50 de zile C0: ' + JSON.stringify(z50).slice(0, 200)
  if (z51.urmarire_stare !== 'de_verificat' || z51.ridicat_propus !== null || z51.contradictii.length) return '51 de zile C0: ' + JSON.stringify(z51).slice(0, 200)
  // bucata mixtă: un AWB peste limită nu strică celelalte AWB-uri din aceeași cerere
  const u = urmCuReper(F)(200, { data: [{ awbNumber: '7000000001', events: oreS2(51).map(([id, date]) => ({ id, date })) },
    { awbNumber: '7000000002', events: [{ id: 'C0', date: T0_ }] }] }, ['7000000001', '7000000002'])
  if (!u.ok || u.pe_awb.get('7000000001')?.urmarire_stare !== 'de_verificat' || u.pe_awb.get('7000000002')?.urmarire_stare !== 'ridicat') return 'bucata mixtă: ' + JSON.stringify([...u.pe_awb])
  return null
}
// ── paritatea cod ↔ BD (L19): limita, tipurile din același răspuns și motivele de retur = cele din migrare ──
const SQL_MIG = readFileSync('supabase/migrations/20270102a_redari_fan_urmarire_auto.sql', 'utf8').replace(/\r/g, '')
const verificaParitateBD = F => {
  const L = F.LIMITA_VALORI_CONTRADICTIE
  const nVal = [...SQL_MIG.matchAll(/jsonb_array_length\(e -> 'valori'\) NOT BETWEEN 2 AND (\d+)/g)].map(x => Number(x[1]))
  const nChk = [...SQL_MIG.matchAll(/jsonb_array_length\(valori\) BETWEEN 1 AND (\d+)\)/g)].map(x => Number(x[1]))
  if (nVal.length !== 1 || nVal[0] !== L || nChk.length !== 1 || nChk[0] !== L) return `limita: cod ${L}, validare ${nVal}, CHECK ${nChk}`
  const v0 = SQL_MIG.indexOf("WHEN ((e ->> 'tip', e ->> 'regula') IN ("), v1 = SQL_MIG.indexOf('IS NOT TRUE THEN false', v0)
  const perechi = [...SQL_MIG.slice(v0, v1).matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(m => [m[1], m[2]])
  const asteptat = Object.entries(F.REGULI_CONTRADICTII).filter(([t]) => t !== 'eveniment_data_imposibila')
  if (JSON.stringify(perechi.sort()) !== JSON.stringify(asteptat.sort())) return 'tipurile din același răspuns: BD ' + JSON.stringify(perechi) + ', cod ' + JSON.stringify(asteptat)
  const mot = (/WHEN 'retur_motiv' THEN '\^\(([a-z_|]+)\)\$'/.exec(SQL_MIG) || [])[1]?.split('|').sort()
  if (!mot || !Object.values(F.RETUR_DIN_CATEGORIE).every(m => mot.includes(m))) return 'motivele de retur din cod lipsesc din validarea BD: ' + mot
  if (JSON.stringify(F.ORDINE_EGALITATE.filter(c => c !== 'necunoscut').sort()) !== JSON.stringify(Object.keys(F.EVENIMENTE_FAN).sort())) return 'ORDINE_EGALITATE nu acoperă exact categoriile'
  return null
}
VERIFICARI.egalitate = async M => verificaEgalitate(cuReper(M.__fan))
VERIFICARI.limita = async M => verificaLimita(M.__fan)
VERIFICARI.paritateBD = async M => verificaParitateBD(M.__fan)
const verificaContradictii = rz => {
  for (const [nume, el, fapte, contr] of CAZURI_CONTRADICTII) {
    const r = rz(el)
    for (const [k, v] of Object.entries(fapte)) if (r[k] !== v) return `${nume}: ${k} = ${JSON.stringify(r[k])}, așteptat ${JSON.stringify(v)}`
    const c = (r.contradictii || []).map(x => [x.tip, x.ales, x.valori, x.regula])
    const a = contr.map(([tip, ales, valori]) => [tip, ales, valori, CR[tip]])
    if (JSON.stringify(c) !== JSON.stringify(a)) return `${nume}: contradicții ${JSON.stringify(c)}, așteptat ${JSON.stringify(a)}`
  }
  return null
}
VERIFICARI.contradictii = async M => verificaContradictii(cuReper(M.__fan))
VERIFICARI.formaRaspuns = async M => {
  const f = M.__fan.interpreteazaUrmarire
  for (const corp of [{ ceva: 1 }, null, 'x', { data: [{ foo: 1 }] }]) { const u = f(200, corp, ['7000000001']); if (u.ok !== false || u.forma_necunoscuta !== true || u.pe_awb.size) return `forma ${JSON.stringify(corp)} acceptată` }
  const g = f(200, { data: [] }, ['7000000001'])
  if (g.ok !== true || g.pe_awb.get('7000000001')?.urmarire_stare !== 'de_verificat') return 'lista goală: AWB-ul nu e „de verificat”'
  return null
}
// ── runda 4 (Jakarinos #1155 r3 P2): lista evenimentelor pentru cronologie (BD-ul ia din ea DOAR momentele posibile). Așteptări scrise de mână:
// evenimentele DISTINCTE, în ordinea completă (oră, departajare, cod), „COD AAAA-LL-ZZ HH:MM:SS”, ultimul = ultimul eveniment; peste 100 = ultimele 100;
// lista goală la răspunsurile fără evenimente; lista ajunge în rândul scris în BD; limita = cea din BD ──
VERIFICARI.cronologie = async M => {
  const rz = cuReper(M.__fan)
  const a = rz(ev(['H3', '2026-11-19 10:00:00'], ['C0', '2026-11-24 10:00:00'], ['S98', '2026-11-18 09:00:00'], ['H3', '2026-11-19 10:00:00'], ['C0', '2026-11-19 10:00:00']))
  // la aceeași oră (19.11 10:00): tranzitul (H3) înaintea ridicării (C0), după ORDINE_EGALITATE; H3 dublat = o singură intrare
  const asteptat = ['S98 2026-11-18 09:00:00', 'H3 2026-11-19 10:00:00', 'C0 2026-11-19 10:00:00', 'C0 2026-11-24 10:00:00']
  if (JSON.stringify(a.evenimente) !== JSON.stringify(asteptat)) return 'lista: ' + JSON.stringify(a.evenimente)
  if (a.ultim_eveniment !== 'C0' || a.ultim_eveniment_la !== '2026-11-24 10:00:00') return 'ultimul eveniment ≠ capătul listei'
  // 120 de evenimente distincte → ultimele 100 (primul păstrat = al 21-lea), capătul = ultimul eveniment
  const multe = Array.from({ length: 120 }, (_, i) => ['H3', `2026-11-19 ${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00`])
  const b = rz(ev(...multe))
  if (b.evenimente?.length !== 100 || b.evenimente[0] !== 'H3 2026-11-19 08:20:00' || b.evenimente.at(-1) !== `H3 ${b.ultim_eveniment_la}` || b.ultim_eveniment_la !== '2026-11-19 09:59:00')
    return '120 de evenimente: ' + JSON.stringify([b.evenimente?.length, b.evenimente?.[0], b.evenimente?.at(-1)])
  if (M.__fan.LIMITA_EVENIMENTE_CRONOLOGIE !== 100) return 'limita listei în cod: ' + M.__fan.LIMITA_EVENIMENTE_CRONOLOGIE
  const lim = [...SQL_MIG.matchAll(/jsonb_array_length\(u\.evenimente\) > (\d+)/g)].map(x => Number(x[1]))
  if (lim.length !== 1 || lim[0] !== M.__fan.LIMITA_EVENIMENTE_CRONOLOGIE) return `limita listei: cod ${M.__fan.LIMITA_EVENIMENTE_CRONOLOGIE}, BD ${lim}`
  // forma necunoscută a unui eveniment: cronologia citită rămâne (de verificat, fără fapte); fără evenimente / AWB absent = listă goală
  const c = rz({ events: [{ id: 'C0', date: '2026-11-18 10:00:00' }, { id: 'C0', date: '18.11.2026' }] })
  if (JSON.stringify(c.evenimente) !== JSON.stringify(['C0 2026-11-18 10:00:00'])) return 'cronologie incompletă: ' + JSON.stringify(c.evenimente)
  if (JSON.stringify(rz({ events: [] }).evenimente) !== '[]' || JSON.stringify(rz(null).evenimente) !== '[]') return 'fără evenimente: lista nu e goală'
  const u = M.__fan.interpreteazaUrmarire(200, { data: [] }, ['7000000001'])
  if (JSON.stringify(u.pe_awb.get('7000000001')?.evenimente) !== '[]') return 'AWB absent: lista nu e goală'
  // lista ajunge în rândul trimis BD-ului (rularea automată = aceeași funcție ca butonul)
  const f = lume()
  await M.ruleazaUrmarireAuto(CRON, f.deps)
  const p = f.rpc.find(x => x.nume === 'fn_red_fan_srv_urmarire')?.args.p_randuri[0]
  if (JSON.stringify(p?.evenimente) !== JSON.stringify(['C0 2026-11-20 10:40:00'])) return 'lista nu ajunge în BD: ' + JSON.stringify(p?.evenimente)
  return null
}

// ── runda 5 (Jakarinos #1155 r4 P1): CLASA „dată imposibilă” pe ORICE eveniment. Așteptări scrise de mână (FAN_URMARIRE_AUTOMATA.md §3b, L25):
// reperul = AWB generat pe 20.11.2026 la 08:00 (ora României), procesat pe 21.11.2026 la 10:00 → limita = 21.11 10:05 (toleranța 300 s) ──
const REPER_JAK = F => F.reperUrmarireFan({ generatLa: '2026-11-20T06:00:00Z', acumMs: Date.parse('2026-11-21T08:00:00Z') })
const VIITOR_ = '2026-11-24 10:00:00', INAINTE_ = '2026-11-19 10:00:00', VALID_ = '2026-11-20 12:00:00', BAZA_ = ['C0', '2026-11-20 09:00:00']
// matricea: fiecare categorie de cod (+ un cod necunoscut) × (în viitor / înainte de generare / valid); starea pentru „valid” scrisă de mână
const MATRICE_STARE_VALID = [['C0', 'ridicat'], ['S2', 'livrat'], ['S3', 'ridicat'], ['S4', 'retur'], ['S5', 'retur'], ['S6', 'retur'], ['S16', 'retur'],
  ['S50', 'de_verificat'], ['S30', 'ridicat'], ['H3', 'ridicat'], ['S98', 'ridicat'], ['S99', 'de_verificat'], ['Z9', 'de_verificat']]
const SQL_PREDICAT = (/CREATE FUNCTION public\.fn_red_fan_moment_posibil\([^)]*\) RETURNS boolean\n[^\n]*\$fn\$\n([^\n]*)\n\$fn\$;/.exec(SQL_MIG) || [])[1] || ''
VERIFICARI.momentPosibil = async M => {
  const F = M.__fan
  const r = REPER_JAK(F)
  if (!r || r.generatZi !== '2026-11-20' || r.acum !== '2026-11-21 10:00:00' || r.limita !== '2026-11-21 10:05:00') return 'reperul: ' + JSON.stringify(r)
  // predicatul: granițele (toleranța inclusă, o secundă peste = imposibil; ziua generării de la 00:00), reper lipsă = imposibil
  for (const [la, asteptat] of [['2026-11-21 10:05:00', true], ['2026-11-21 10:05:01', false], ['2026-11-21 09:59:59', true], ['2026-11-20 00:00:00', true],
    ['2026-11-19 23:59:59', false], [VIITOR_, false], ['2026-11-21 23:00:00', false], ['21.11.2026', false]]) if (F.momentPosibilFan(la, r) !== asteptat) return `momentPosibilFan(${la}) ≠ ${asteptat}`
  if (F.momentPosibilFan(VALID_, null) !== false || F.reperUrmarireFan({ generatLa: null, acumMs: 0 }) !== null || F.reperUrmarireFan({ generatLa: GEN_LA }) !== null) return 'reper lipsă ≠ imposibil'
  // paritatea cu BD: aceeași toleranță și aceeași formă a predicatului (fn_red_fan_moment_posibil, 20270102a)
  if (F.TOLERANTA_VIITOR_S !== 300 || SQL_PREDICAT.trim() !== `SELECT (p_la::date >= p_generat_zi AND p_la <= p_acum + interval '${F.TOLERANTA_VIITOR_S} seconds') IS TRUE`) return 'predicatul BD ≠ cod: ' + SQL_PREDICAT
  // scenariul lui Jakarinos (r4): la 21.11, C0 20.11 08:00 + S2 24.11 10:00 → ridicat, FĂRĂ livrare, S2 respins (doar audit); apoi corecția S2 20.11 10:00 → livrat
  const rz = el => F.rezumatUrmarireFan(el, r)
  const a = rz(ev(['C0', '2026-11-20 08:00:00'], ['S2', VIITOR_]))
  if (a.urmarire_stare !== 'ridicat' || a.livrat_la !== null || a.ridicat_propus !== '2026-11-20' || a.ultim_eveniment_la !== '2026-11-20 08:00:00' || a.contradictii.length
      || JSON.stringify(a.evenimente) !== '["C0 2026-11-20 08:00:00"]' || JSON.stringify(a.respinse) !== `["S2 ${VIITOR_}"]`) return 'Jakarinos, rularea 1: ' + JSON.stringify(a)
  const b = rz(ev(['C0', '2026-11-20 08:00:00'], ['S2', '2026-11-20 10:00:00']))
  if (b.urmarire_stare !== 'livrat' || b.livrat_la !== '2026-11-20 10:00:00' || b.respinse.length || b.ultim_eveniment_la !== '2026-11-20 10:00:00') return 'Jakarinos, corecția: ' + JSON.stringify(b)
  // matricea: imposibil = EXACT ca răspunsul fără el (+ el în `respinse`); valid = starea scrisă de mână
  const baza = rz(ev(BAZA_))
  for (const [cod, stare] of MATRICE_STARE_VALID) {
    for (const t of [VIITOR_, INAINTE_]) {
      const x = rz(ev(BAZA_, [cod, t]))
      if (JSON.stringify({ ...x, respinse: [] }) !== JSON.stringify(baza) || JSON.stringify(x.respinse) !== JSON.stringify([`${cod} ${t}`])) return `matricea ${cod} la ${t}: ${JSON.stringify(x)}`
    }
    const v = rz(ev(BAZA_, [cod, VALID_]))
    if (v.urmarire_stare !== stare || v.respinse.length) return `matricea ${cod} valid: ${v.urmarire_stare}, așteptat ${stare}`
  }
  // `respinse`: cel mult 100 (= BD); peste = de verificat, fără fapte, cu numărul în motiv; limita BD = cea din cod
  const viitoare = n => Array.from({ length: n }, (_, i) => ['H3', `2026-11-2${5 + Math.floor(i / 60)} 10:${String(i % 60).padStart(2, '0')}:00`])
  const r100 = rz(ev(BAZA_, ...viitoare(100))), r101 = rz(ev(BAZA_, ...viitoare(101)))
  if (r100.respinse.length !== 100 || r100.urmarire_stare !== 'ridicat') return '100 respinse: ' + JSON.stringify([r100.respinse.length, r100.urmarire_stare])
  if (r101.respinse.length !== 100 || r101.urmarire_stare !== 'de_verificat' || r101.ridicat_propus !== null || !/101/.test(r101.motiv || '')) return '101 respinse: ' + JSON.stringify([r101.respinse.length, r101.urmarire_stare, r101.motiv])
  const limR = [...SQL_MIG.matchAll(/jsonb_array_length\(u\.respinse\) > (\d+)/g)].map(x => Number(x[1]))
  if (limR.length !== 1 || limR[0] !== F.LIMITA_EVENIMENTE_CRONOLOGIE) return 'limita respinse BD: ' + limR
  // transportul: reperul din rând (generat_la) + ceasul injectat; `respinse` ajung în rândul trimis BD-ului
  // (rândurile lumii: generate pe 15.11, ceasul 21.11 11:00 → H3 din 14.11 = înainte de generare, S2 din 24.11 = în viitor)
  const f = lume({ fanRaspuns: url => json(200, { data: new URL(url).searchParams.getAll('awb[]').map(x => ({ awbNumber: x,
    events: [{ id: 'H3', date: '2026-11-14 10:00:00' }, { id: 'C0', date: '2026-11-20 10:40:00' }, { id: 'S2', date: VIITOR_ }] })) }) })
  await M.ruleazaUrmarireAuto(CRON, f.deps)
  const p = f.rpc.find(x => x.nume === 'fn_red_fan_srv_urmarire')?.args.p_randuri[0]
  if (p?.urmarire_stare !== 'ridicat' || p?.livrat_la !== null || JSON.stringify(p?.evenimente) !== '["C0 2026-11-20 10:40:00"]'
      || JSON.stringify(p?.respinse) !== `["H3 2026-11-14 10:00:00","S2 ${VIITOR_}"]`) return 'transportul: ' + JSON.stringify(p)
  // un rând fără ziua generării = nimic cerut curierului, rularea oprită cu motivul ei
  const g = lume({ loturi: [{ ...lot(L1, 2), randuri: lot(L1, 2).randuri.map((x, i) => (i ? { ...x, generat_la: null } : x)) }] })
  await M.ruleazaUrmarireAuto(CRON, g.deps)
  if (tracking(g).length || inchidere(g)?.p_stare !== 'oprita_eroare' || inchidere(g)?.p_eroare_cod !== 'reper_lipsa') return 'reper lipsă: ' + JSON.stringify([tracking(g).length, inchidere(g)])
  return null
}

describe('runda 5 (Jakarinos #1155 r4 P1): o singură regulă pentru ORICE eveniment cu dată imposibilă — cod (și paritatea cu BD)', () => {
  it('regula, scenariul recenzentului, matricea tip × dată, limita `respinse`, transportul și reperul lipsă trec pe codul real', async () => {
    expect(await VERIFICARI.momentPosibil(REAL)).toBeNull()
  })
  it.each(MATRICE_STARE_VALID)('matricea, codul %s: în viitor și înainte de generare = respins (ca fără el); valid = %s', (cod, stare) => {
    const rz = el => rezumatUrmarireFan(el, REPER_JAK(FAN_REAL))
    const baza = rz(ev(BAZA_))
    for (const t of [VIITOR_, INAINTE_]) expect(rz(ev(BAZA_, [cod, t]))).toEqual({ ...baza, respinse: [`${cod} ${t}`] })
    expect(rz(ev(BAZA_, [cod, VALID_]))).toMatchObject({ urmarire_stare: stare, respinse: [] })
  })
  it('fără reper: nimic înregistrat (de verificat, fără fapte)', () => {
    expect(rezumatUrmarireFan(ev(BAZA_))).toMatchObject({ urmarire_stare: 'de_verificat', ridicat_propus: null, evenimente: [], respinse: [], motiv: expect.stringMatching(/reperul de timp/) })
  })
})

describe('regula contradicțiilor (decizia owner-ului 21.11.2026): toate evaluate, faptele după regulă, contradicțiile în listă — rezumatUrmarireFan', () => {
  it.each(CAZURI_CONTRADICTII)('%s', (_, el, fapte, contr) => {
    const r = rzT(el)
    expect(r).toMatchObject(fapte)
    expect(r.contradictii.map(x => [x.tip, x.ales, x.valori, x.regula])).toEqual(contr.map(([tip, ales, valori]) => [tip, ales, valori, CR[tip]]))
  })
  it('lista regulilor = cea din BD (CHECK-ul red_fan_contradictii_regula și validarea din fn_red_fan_urmarire_scrie, 20270102a)', () => {
    const sql = readFileSync('supabase/migrations/20270102a_redari_fan_urmarire_auto.sql', 'utf8').replace(/\r/g, '')
    const chk = sql.slice(sql.indexOf('CONSTRAINT red_fan_contradictii_regula CHECK'), sql.indexOf('CONSTRAINT red_fan_contradictii_cheie_uq'))
    const perechi = [...chk.matchAll(/\('([a-z_]+)', '([a-z_]+)'\)/g)].map(m => [m[1], m[2]])
    expect(Object.fromEntries(perechi)).toEqual({ ...CR })
    expect(sql).toContain("CHECK (versiune_regula = 'fan-contradictii-v1')")
    expect(FAN_REAL.VERSIUNE_REGULA_CONTRADICTII).toBe('fan-contradictii-v1')
  })
  it('interpreteazaUrmarire: forma necunoscută a întregului răspuns = eroare (nimic scris), nu „de verificat”', () => {
    expect(interpreteazaUrmarire(200, { ceva: 1 }, ['7000000001'])).toMatchObject({ ok: false, forma_necunoscuta: true })
  })
  it('verificările adăugate în runda 2 (contradicții, forma răspunsului) trec pe codul real', async () => {
    expect(await VERIFICARI.contradictii(REAL)).toBeNull()
    expect(await VERIFICARI.formaRaspuns(REAL)).toBeNull()
  })
  // runda 3 (Jakarinos #1155 r2)
  it.each(CAZURI_EGALITATE)('P1 — toate ordinile: %s', (_, evs, fapte, contr) => {
    const rez = permutari(evs).map(p => rzT(ev(...p)))
    expect(new Set(rez.map(r => JSON.stringify(r))).size).toBe(1)
    expect(rez[0]).toMatchObject(fapte)
    expect(rez[0].contradictii.map(x => [x.tip, x.ales, x.valori, x.regula])).toEqual(contr.map(([t, a, v]) => [t, a, v, CR[t]]))
  })
  it('P1 — reproducerea recenzentului: [S2, S6] și [S6, S2] la 10:00 dau același retur „refuz” și aceeași contradicție', () => {
    const a = rzT(ev(['S2', T_], ['S6', T_])), b = rzT(ev(['S6', T_], ['S2', T_]))
    expect(a).toEqual(b)
    expect([a.urmarire_stare, a.retur_propus, a.contradictii.length]).toEqual(['retur', 'refuz', 1])
  })
  it('P2 — limita comună (50) și bucata mixtă; paritatea cod ↔ BD (limita, tipurile, motivele, categoriile)', async () => {
    expect(verificaLimita(FAN_REAL)).toBeNull()
    expect(verificaParitateBD(FAN_REAL)).toBeNull()
    expect(FAN_REAL.LIMITA_VALORI_CONTRADICTIE).toBe(50)
  })
  it('runda 4: lista pentru cronologie (distincte, în ordinea completă, ultimele 100, capătul = ultimul eveniment, trimisă BD-ului, limita = BD)', async () => {
    expect(await VERIFICARI.cronologie(REAL)).toBeNull()
  })
  it('verificările adăugate în runda 3 (egalitate, limită, paritate) trec pe codul real', async () => {
    for (const k of ['egalitate', 'limita', 'paritateBD']) expect(await VERIFICARI[k](REAL)).toBeNull()
  })
})

describe('butonul „Urmărire” (F1): aceeași regulă ca rularea; p_actor = omul, p_rulare NULL, fără pasul plafonului', () => {
  it('executaActiuneFan „urmarire” scrie cu clasa B, p_actor = uid; rândurile poartă faptele rezolvate + contradicțiile; 401 = un login nou + o reluare', async () => {
    const UID = 'f0000000-0000-4000-8000-000000000001'
    const scrieri = [], get = []
    let n = 0
    const deps = {
      secrete: () => ({ username: 'u', password: 'p', clientId: '7' }),
      fetch: async (url, init = {}) => {
        if (new URL(url).pathname === '/login') return json(200, { data: { token: 't' } })
        get.push(url)
        if (++n === 1) return json(401, null)
        return json(200, { data: [{ awbNumber: '7000000001', events: [{ id: 'C0', date: '2026-11-18 10:00:00' }, { id: 'C0', date: '2026-11-19 09:00:00' }] }] })
      },
      randuriLot: async () => ({ data: [{ id: rid(L1, 1), plic_id: 'p', nr_plic: 'PL-TST-0001', stare: 'generat', awb: '7000000001', versiune_urmarire: 1, generat_la: GEN_LA }] }),
      rpcServer: async (nm, a) => { scrieri.push({ n: nm, a }); return { data: { scrise: 1, pastrate: 0, depasite: 0, contradictii: 1, ridicari: 1 } } },
      pauza: async () => {},
      acum: () => T_ACUM,
    }
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire', lot_id: L1 }, lot: { id: L1 }, uid: UID }, deps)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ scrise: 1, contradictii: 1, ridicari: 1 })
    expect(get.length).toBe(2)
    expect(scrieri).toEqual([{ n: 'fn_red_fan_srv_urmarire', a: expect.objectContaining({ p_actor: UID, p_rulare: null, p_lot_id: L1 }) }])
    expect(scrieri[0].a.p_randuri[0]).toMatchObject({ urmarire_stare: 'ridicat', ridicat_propus: '2026-11-18', retur_la: null,
      contradictii: [{ tip: 'ridicare_zile', valori: ['2026-11-18', '2026-11-19'], ales: '2026-11-18', regula: 'prima_ridicare' }] })
  })
  it('forma necunoscută la buton: eroare afișată, nimic scris', async () => {
    const scrieri = []
    const deps = {
      secrete: () => ({ username: 'u', password: 'p', clientId: '7' }),
      fetch: async url => (new URL(url).pathname === '/login' ? json(200, { data: { token: 't' } }) : json(200, { ceva: 1 })),
      randuriLot: async () => ({ data: [{ id: rid(L1, 1), plic_id: 'p', nr_plic: 'PL-TST-0001', stare: 'generat', awb: '7000000001', versiune_urmarire: 1, generat_la: GEN_LA }] }),
      rpcServer: async (nm, a) => { scrieri.push(nm); return { data: { scrise: 1, pastrate: 0, depasite: 0 } } },
      pauza: async () => {},
    }
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire', lot_id: L1 }, lot: { id: L1 }, uid: 'f0000000-0000-4000-8000-000000000001' }, deps)
    expect([r.status, r.body.cod, scrieri.length]).toEqual([502, 'urmarire_forma_necunoscuta', 0])
  })
})

describe('ecranul: ridicarea nu mai e „propusă” pe TEST; lista de audit „Contradicții FAN”', () => {
  it('etichetele acoperă EXACT tipurile și regulile din BD; textul unei contradicții arată valorile, alesul, regula, sursa', async () => {
    const L = await import('./fanLot.js')
    expect(Object.keys(L.ETICHETE_CONTRADICTIE).sort()).toEqual(Object.keys(REGULI_CONTRADICTII).sort())
    expect(Object.keys(L.ETICHETE_REGULA).sort()).toEqual(Object.values(REGULI_CONTRADICTII).sort())
    expect(L.textContradictie({ tip: 'livrare_ore', valori: ['2026-11-20 10:40:00', '2026-11-20 12:00:00'], ales: '2026-11-20 12:00:00', regula: 'ultima_livrare', sursa: 'acelasi_raspuns', observari: 2 }))
      .toBe('ore de livrare (S2) diferite: 2026-11-20 10:40:00 / 2026-11-20 12:00:00 → ales 2026-11-20 12:00:00 (rămâne ultima oră de livrare); în același răspuns FAN; văzută de 2 ori')
    expect(L.lipsaTabelContradictii({ code: '42P01' }) && L.lipsaTabelContradictii({ code: 'PGRST205' }) && !L.lipsaTabelContradictii({ code: '42501' })).toBe(true)
  })
  it('„6b. Confirmă ridicarea” = doar loturile reale; lista de audit e citită cu JWT-ul omului, keyset pe id, eroarea ≠ „nicio contradicție”', () => {
    const src = readFileSync('src/redari/ui/FanAwbPrevizualizare.jsx', 'utf8').replace(/\r/g, '')
    expect(src).toMatch(/r\.stare === 'generat' && r\.ridicat_propus && !r\.ridicat_contrazis && fan\?\.fanLot\?\.test !== true/)
    expect(src).toMatch(/<FanContradictii client=\{supabase\} lotId=\{lot\.id\} awb=\{awb\} activ=\{!!fan\?\.instalata\} reload=\{reload\} \/>/)
    const c = readFileSync('src/redari/ui/FanContradictii.jsx', 'utf8').replace(/\r/g, '')
    expect(c).toMatch(/citestePaginat\(\(\) => client\.from\('red_fan_contradictii'\)\.select\(COL_CONTRADICTII\)\.eq\('lot_id', lotId\), \{ cheie: 'id', esteCurent: curent \}\)/)
    expect(c).toMatch(/else setEroare\(msgEroare\(e\)\)/)
    expect(c).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.rpc\(/)
  })
})

describe('butonul „Urmărire” (F1): p_actor = omul, p_rulare NULL', () => {
  it('executaActiuneFan „urmarire” scrie cu clasa B, p_actor = uid', async () => {
    const UID = 'f0000000-0000-4000-8000-000000000001'
    const scrieri = []
    const deps = {
      secrete: () => ({ username: 'u', password: 'p', clientId: '7' }),
      fetch: async (url, init = {}) => (new URL(url).pathname === '/login' ? json(200, { data: { token: 't' } }) : urmarireOk(url, init)),
      randuriLot: async () => ({ data: [{ id: rid(L1, 1), plic_id: 'p', nr_plic: 'PL-TST-0001', stare: 'generat', awb: '7000000001', versiune_urmarire: 1, generat_la: GEN_LA }] }),
      rpcServer: async (n, a) => { scrieri.push({ n, a }); return { data: { scrise: 1, pastrate: 0, depasite: 0 } } },
      pauza: async () => {},
      acum: () => T_ACUM,
    }
    const r = await executaActiuneFan({ corp: { actiune: 'urmarire', lot_id: L1 }, lot: { id: L1 }, uid: UID }, deps)
    expect(r.status).toBe(200)
    expect(scrieri).toEqual([{ n: 'fn_red_fan_srv_urmarire', a: expect.objectContaining({ p_actor: UID, p_rulare: null, p_lot_id: L1 }) }])
  })
})

// ── mutanți: modulele copiate într-un folder temporar, cu o singură mutație; cel puțin o verificare trebuie să PICE ──
const SURSE = Object.fromEntries(['redariFan.mjs', 'redariFanTransport.mjs', 'redariFanHandler.mjs', 'redariFanUrmarireAuto.mjs']
  .map(n => [n, readFileSync(join('supabase/functions/_shared', n), 'utf8').replace(/\r/g, '')]))   // CRLF la checkout pe Windows: mutațiile cu \n se potrivesc identic pe CI
// sub .tmp/ din depozit (ignorat de git), ca în fanCourierMutanti.test.js: calea scurtă a folderului temporar Windows (GAZPET~1) nu se importă prin vite
mkdirSync(join(process.cwd(), '.tmp'), { recursive: true })
const DIR = mkdtempSync(join(process.cwd(), '.tmp', 'fan_auto_mut_'))
afterAll(() => rmSync(DIR, { recursive: true, force: true }))
let nrMutant = 0
// `din` = text (o mutație) sau listă de perechi [din, în] (mutație compusă, runda 3: ex. codul vechi = două schimbări deodată)
async function cuMutatie(fisier, din, in_) {
  const s = { ...SURSE }
  for (const [d, i] of Array.isArray(din) ? din : [[din, in_]]) {
    const parti = s[fisier].split(d)
    if (parti.length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${fisier}: ${d.slice(0, 80)}`)
    s[fisier] = parti.join(i)
  }
  const d = join(DIR, 'm' + (++nrMutant))
  mkdirSync(d, { recursive: true })
  for (const [n, t] of Object.entries(s)) writeFileSync(join(d, n), t)
  const [a, t, f] = await Promise.all(['redariFanUrmarireAuto.mjs', 'redariFanTransport.mjs', 'redariFan.mjs'].map(n => import(pathToFileURL(join(d, n)).href)))
  return { ...a, __transport: t, __fan: f }
}
const MUTANTI = [
  ['poarta: orice apelant acceptat', 'redariFanUrmarireAuto.mjs', "if (!['cron', 'owner'].includes(sursa)) return out(401, 'neautorizat')", "if (false) return out(401, 'neautorizat')"],
  ['poarta: owner fără actor verificat', 'redariFanUrmarireAuto.mjs', "if (sursa === 'owner' && !(typeof apelant.actor === 'string' && UUID.test(apelant.actor))) return out(401, 'neautorizat')", ''],
  ['garda de fetch: orice cale permisă', 'redariFanUrmarireAuto.mjs', "return APELURI_FAN_RULARE.some(([mm, cc]) => mm === m && cc === cale) ? cale : null", 'return cale'],
  ['garda de fetch: compară prefixul, nu calea exactă', 'redariFanUrmarireAuto.mjs', 'mm === m && cc === cale', 'mm === m && cale.startsWith(cc)'],
  ['plafonul: pasul BD-ului înaintea GET-ului scos (transport)', 'redariFanTransport.mjs', '      let refuz = await pas()   // înaintea login-ului', '      let refuz = null   // înaintea login-ului'],
  // runda 2 (Jakarinos #1155 r1 P2): reluarea după 401 trece prin plafon, cu pauză; rularea cere clientul cu plafon
  ['reautentificarea ocolește plafonul (reluarea fără pas)', 'redariFanTransport.mjs', '        refuz = await pas()\n', '        refuz = null\n'],
  ['reluarea după 401 fără pauză', 'redariFanTransport.mjs', "        if (typeof inainteDeApel === 'function' && typeof pauza === 'function') await pauza(PAUZA_INTRE_CERERI_MS)\n", ''],
  ['rularea construiește clientul FĂRĂ pasul plafonului', 'redariFanUrmarireAuto.mjs', 'clientFan({ fetch: fetchRulare, secrete: s, inainteDeApel, pauza: deps.pauza })', 'clientFan({ fetch: fetchRulare, secrete: s, pauza: deps.pauza })'],
  ['urmaresteLot acceptă o rulare cu un client fără plafon', 'redariFanTransport.mjs', "  if (rulare && fan?.cuPlafon !== true) return out(423", '  if (false) return out(423'],
  // runda 2 (P2): forma necunoscută a întregului răspuns oprește rularea
  ['forma necunoscută acceptată ca „de verificat”', 'redariFan.mjs', "  if (!lista) return { ok: false, forma_necunoscuta: true,", "  if (!lista) return { ok: true, forma_necunoscuta: true,"],
  ['lista fără niciun AWB recunoscut acceptată', 'redariFan.mjs', "  if (lista.length > 0 && !lista.some(el => awbDin(el))) return", '  if (false) return'],
  ['oprirea la forma necunoscută raportată ca altă eroare', 'redariFanUrmarireAuto.mjs', "b.cod === 'urmarire_forma_necunoscuta' ? 'fan_forma_necunoscuta'", "false ? 'fan_forma_necunoscuta'"],
  // runda 2 (P1 + decizia owner-ului): toate contradicțiile, regula deterministă
  ['contradicția C0 (două zile) nu mai e înregistrată', 'redariFan.mjs', "  if (zileC0.length > 1) contradictii.push(", "  if (false) contradictii.push("],
  ['contradicția S2 (două ore) nu mai e înregistrată', 'redariFan.mjs', "  if (oreS2.length > 1) contradictii.push(", "  if (false) contradictii.push("],
  ['ridicarea = ultima zi C0, nu prima', 'redariFan.mjs', '  const ridicat = zileC0[0] || null', '  const ridicat = zileC0.at(-1) || null'],
  ['livrarea = prima oră S2, nu ultima', 'redariFan.mjs', '  const livratLa = oreS2.at(-1) || null', '  const livratLa = oreS2[0] || null'],
  ['egalitatea livrare / retur merge la livrare', 'redariFan.mjs', "returLa !== null && livratLa > returLa ? 'livrat' : 'retur'", "returLa !== null && livratLa >= returLa ? 'livrat' : 'retur'"],
  ['returul fără oră (returnAwbNumber) nu mai câștigă', 'redariFan.mjs', "returLa !== null && livratLa > returLa ? 'livrat' : 'retur'", "(returLa === null || livratLa > returLa) ? 'livrat' : 'retur'"],
  ['oprire la prima contradicție (livrare + retur neevaluat după alta)', 'redariFan.mjs', '  if (areRetur && livratLa) {', '  if (areRetur && livratLa && !contradictii.length) {'],
  ['faptele dintr-o cronologie incompletă înregistrate', 'redariFan.mjs', "  if (stricat) return { ...gol, ...cronologie, motiv:", "  if (false) return { ...gol, ...cronologie, motiv:"],
  ['transportul nu trimite contradicțiile în BD', 'redariFanTransport.mjs', 'retur_la: z.retur_la ?? null, contradictii: z.contradictii || [] }', 'retur_la: z.retur_la ?? null, contradictii: [] }'],
  // runda 3 (Jakarinos #1155 r2): P1 egalitatea orelor, P2 limita comună
  ['egalitate: ordinea doar după oră (fără departajare)', 'redariFan.mjs', '  toate.sort(ordineEvenimente)', '  toate.sort((a, b) => (a.la < b.la ? -1 : a.la > b.la ? 1 : 0))'],
  ['egalitate: codul r2 (doar ora + doar ultimul element al listei)', 'redariFan.mjs', [['  toate.sort(ordineEvenimente)', '  toate.sort((a, b) => (a.la < b.la ? -1 : a.la > b.la ? 1 : 0))'],
    ['  const laFinal = ev.filter(e => e.la === ultim?.la)', '  const laFinal = ultim ? [ultim] : []']]],
  ['egalitate: livrarea departajată după retururi', 'redariFan.mjs', [["'avizat', 'livrat', 'confirmare_refuzata'", "'avizat', 'confirmare_refuzata'"], ["'refuz', 'retur'])", "'refuz', 'retur', 'livrat'])"]]],
  ['egalitate: refuzul / adresa de la ora finală nu mai sunt dovezi de retur', 'redariFan.mjs', '...laFinal.filter(e => SEMNAL_FINAL_RETUR.includes(e.cat))].sort(ordineEvenimente)', '].sort(ordineEvenimente)'],
  ['egalitate: motivul = primul semnal de la aceeași oră (nedepartajat)', 'redariFan.mjs', '  const ultimSemnal = semnale.at(-1) || null', '  const ultimSemnal = semnale.filter(e => e.la === semnale.at(-1)?.la)[0] || null'],
  ['egalitate: contradicția retur_motiv neînregistrată', 'redariFan.mjs', '    if (motive.length > 1) contradictii.push(', '    if (false) contradictii.push('],
  ['limita: peste 50 de valori trimis mai departe', 'redariFan.mjs', '  if (prea.length) return', '  if (false) return'],
  ['limita: 20 în cod (≠ BD)', 'redariFan.mjs', 'export const LIMITA_VALORI_CONTRADICTIE = 50', 'export const LIMITA_VALORI_CONTRADICTIE = 20'],
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
  // runda 4 (Jakarinos #1155 r3 P2): lista pentru cronologie
  ['cronologie: lista netrimisă în BD', 'redariFanTransport.mjs', 'evenimente: Array.isArray(z.evenimente) ? z.evenimente : null,', 'evenimente: null,'],
  ['cronologie: dublurile păstrate', 'redariFan.mjs', '.filter((x, i, a) => i === 0 || x !== a[i - 1])', ''],
  ['cronologie: primele 100, nu ultimele', 'redariFan.mjs', 'ev => textEvenimente(ev).slice(-LIMITA_EVENIMENTE_CRONOLOGIE)', 'ev => textEvenimente(ev).slice(0, LIMITA_EVENIMENTE_CRONOLOGIE)'],
  ['cronologie: limita 50 în cod (≠ BD)', 'redariFan.mjs', 'export const LIMITA_EVENIMENTE_CRONOLOGIE = 100', 'export const LIMITA_EVENIMENTE_CRONOLOGIE = 50'],
  ['cronologie: lista în ordinea FAN, nu în ordinea completă', 'redariFan.mjs', 'evenimente: listaCronologie(ev), respinse }', 'evenimente: listaCronologie(el.events.map(e => ({ cod: e.id, la: e.date }))), respinse }'],
  // runda 5 (Jakarinos #1155 r4 P1): clasa „dată imposibilă” pe ORICE eveniment, aceeași regulă ca BD-ul
  ['regula: codul r4 (doar C0 respins, livrarea viitoare = fapt)', 'redariFan.mjs', '  const ev = toate.filter(e => momentPosibilFan(e.la, reper))', "  const ev = toate.filter(e => e.cat !== 'ridicat' || momentPosibilFan(e.la, reper))"],
  ['regula: niciun eveniment respins (toate = posibile)', 'redariFan.mjs', '  const ev = toate.filter(e => momentPosibilFan(e.la, reper))', '  const ev = toate'],
  ['regula: fără toleranță (0 s, ≠ BD)', 'redariFan.mjs', 'export const TOLERANTA_VIITOR_S = 300', 'export const TOLERANTA_VIITOR_S = 0'],
  ['regula: fără limita de jos (ziua generării)', 'redariFan.mjs', ' && la.slice(0, 10) >= reper.generatZi && la <= reper.limita', ' && la <= reper.limita'],
  ['regula: pe zi, nu pe moment', 'redariFan.mjs', ' && la.slice(0, 10) >= reper.generatZi && la <= reper.limita', ' && la.slice(0, 10) >= reper.generatZi && la.slice(0, 10) <= reper.limita.slice(0, 10)'],
  ['regula: reperul fără ziua generării', 'redariFan.mjs', 'Object.freeze({ generatZi: g.data, acum: a.local, limita })', "Object.freeze({ generatZi: '0000-01-01', acum: a.local, limita })"],
  ['regula: limita = acum, fără toleranță (pe calea reperului)', 'redariFan.mjs', '  const limita = a ? adunaSecundeLocal(a.local, TOLERANTA_VIITOR_S) : null', '  const limita = a ? adunaSecundeLocal(a.local, 0) : null'],
  ['respinse: netrimise în BD', 'redariFanTransport.mjs', 'respinse: Array.isArray(z.respinse) ? z.respinse : [],', 'respinse: [],'],
  ['respinse: peste 100 trimise mai departe cu fapte', 'redariFan.mjs', '  if (respinseToate.length > LIMITA_EVENIMENTE_CRONOLOGIE) return', '  if (false) return'],
  ['respinse: lipsă din rezultat', 'redariFan.mjs', 'evenimente: listaCronologie(ev), respinse }', 'evenimente: listaCronologie(ev), respinse: [] }'],
  ['reper lipsă: cererea pleacă oricum', 'redariFanTransport.mjs', '  if (lista.some(r => !reperUrmarireFan({ generatLa: r.generat_la, acumMs: 0 }))) return', '  if (false) return'],
  ['reper lipsă: rularea nu se oprește cu motivul ei', 'redariFanUrmarireAuto.mjs', "      if (r.status === 503 && b.cod === COD_REPER_LIPSA) return incheie('oprita_eroare', COD_REPER_LIPSA)\n", ''],
  ['reperul fără ziua generării rândului (transport)', 'redariFanTransport.mjs', 'reperUrmarireFan({ generatLa: r.generat_la, acumMs: t })', "reperUrmarireFan({ generatLa: '2000-01-01T00:00:00Z', acumMs: t })"],
  ['reperul fără ceasul injectat (momentul 0)', 'redariFanTransport.mjs', '    const t = acumMs(deps)\n', '    const t = 0\n'],
]
describe('mutanți (fiecare trebuie să pice cel puțin o verificare)', () => {
  it.each(MUTANTI)('%s', async (_, fisier, din, in_) => {
    const M = await cuMutatie(fisier, din, in_)
    const picate = []
    for (const [nume, v] of Object.entries(VERIFICARI)) { let e; try { e = await v(M) } catch (x) { e = 'excepție: ' + x.message } if (e) picate.push(nume + ': ' + e) }
    expect(picate.length, 'mutantul a trecut toate verificările').toBeGreaterThan(0)
  })
  it('martorul: copia NEMUTATĂ a modulelor trece toate verificările (prinderea vine din mutație, nu din copiere)', async () => {
    const M = await cuMutatie('redariFan.mjs', 'export const VERSIUNE_REGULA_CONTRADICTII', 'export const VERSIUNE_REGULA_CONTRADICTII')
    const picate = []
    for (const [nume, v] of Object.entries(VERIFICARI)) { let e; try { e = await v(M) } catch (x) { e = 'excepție: ' + x.message } if (e) picate.push(nume + ': ' + e) }
    expect(picate).toEqual([])
  })
})
