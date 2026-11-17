// Mutanți pe codul FAN (JS): fiecare verificare trebuie să TREACĂ pe codul real și să PICE pe codul mutat — altfel testul nu păzește regula.
// Mutanții pe SQL (limita de 100 la claim, idempotența, plafonul pilot, lotul de test, poarta owner) sunt în proba PGlite a migrării
// (scripts/pglite/test_redari_fan_awb_local.mjs). Modulele se copiază într-un folder temporar (cu mutația) și se importă de acolo.
import { describe, it, expect, vi, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'

const SURSE = {
  'redariFan.mjs': readFileSync('supabase/functions/_shared/redariFan.mjs', 'utf8'),
  'redariFanTransport.mjs': readFileSync('supabase/functions/_shared/redariFanTransport.mjs', 'utf8'),
  'redariFanHandler.mjs': readFileSync('supabase/functions/_shared/redariFanHandler.mjs', 'utf8'),
  'fanLot.js': readFileSync('src/redari/fanLot.js', 'utf8').replace("'../../supabase/functions/_shared/redariFanHandler.mjs'", "'./redariFanHandler.mjs'"),
}
// folderul temporar stă în .tmp/ (ignorat de git): pe Windows, calea scurtă din %TEMP% (GAZPET~1) nu se încarcă prin vite
const TMP = join(process.cwd(), '.tmp')
mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
async function incarca(mutatie) {
  const dir = mkdtempSync(join(TMP, 'fan_mutant_'))
  foldere.push(dir)
  for (const [nume, text] of Object.entries(SURSE)) {
    let t = text
    if (mutatie && mutatie.fisier === nume) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${nume}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    writeFileSync(join(dir, nume), t)
  }
  const m = n => import(pathToFileURL(join(dir, n)).href)
  return { fan: await m('redariFan.mjs'), tr: await m('redariFanTransport.mjs'), h: await m('redariFanHandler.mjs'), lot: await m('fanLot.js') }
}

// ── fixtura comună: plicuri fictive + FAN simulat ──
const LOT = { id: '11111111-2222-4333-8444-555555555555', proiect_id: 'p1', nr_lot: 'PP-0001' }
const contact = { telefon: '0700000001', adresa_strada: 'Str. Fictivă 1', adresa_sat: 'Sat', adresa_judet: 'Prahova' }
const raspuns = (status, corp) => ({ status, json: async () => corp, arrayBuffer: async () => new ArrayBuffer(0) })
async function ruleaza(M, n, { stari = {}, handler }) {
  const plicuri = Array.from({ length: n }, (_, i) => ({ id: `pl${i + 1}`, nr_plic: `PL-TST-${String(i + 1).padStart(4, '0')}`, destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }))
  const convocari = plicuri.map((p, i) => ({ id: `c${i}`, plic_id: p.id, detinator_id: `d${i}` }))
  const contacte = plicuri.map((p, i) => ({ detinator_id: `d${i}`, ...contact }))
  const pr = await M.fan.pregatestePlicuriFan({ plicuri, convocari, contacte, proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
  const randuri = pr.map((x, i) => ({ id: `r${String(i).padStart(4, '0')}`, plic_id: x.plic.id, nr_plic: x.plic.nr_plic, stare: stari[i] || 'aprobat', hash_date: x.hash, awb: null }))
  const apeluri = [], jurnal = []
  const fetch = async (url, init) => {
    const u = new URL(url)
    if (u.pathname === '/login') return raspuns(200, { data: { token: 't' } })
    apeluri.push({ cale: u.pathname, corp: init.body ? JSON.parse(init.body) : null, q: u.searchParams })
    return handler(u, init, apeluri)
  }
  const deps = {
    secrete: () => ({ username: 'u', password: 'p', clientId: 'C' }), randuriLot: async () => ({ data: randuri }), proiect: async () => ({ data: { cod: 'TEST-RAZVAN' } }),
    datePlicuri: async () => ({ data: { plicuri, convocari, contacte } }), pauza: async () => {}, subtle: webcrypto.subtle, fetch,
    rpc: async (nume, args) => { jurnal.push({ nume, args }); return nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-000000000001' } : { data: (args.p_rezultate || args.p_randuri || []).length } },
  }
  const r = await M.tr.executaActiuneFan({ corp: { actiune: 'genereaza' }, lot: LOT }, deps)
  return { r, apeluri, jurnal }
}
const toateOk = (u, init) => raspuns(200, { response: JSON.parse(init.body).shipments.map((s, i) => ({ awbNumber: String(3000000000 + Number(s.info.content.slice(-4))) })) })

const VERIFICARI = {
  async limita100(M) {
    const { apeluri } = await ruleaza(M, 250, { handler: toateOk })
    return JSON.stringify(apeluri.filter(a => a.cale === '/intern-awb').map(a => a.corp.shipments.length)) === '[100,100,50]'
  },
  async idempotenta(M) {
    const { apeluri } = await ruleaza(M, 3, { stari: { 0: 'generat', 1: 'in_curs', 2: 'necunoscut' }, handler: toateOk })
    return apeluri.length === 0
  },
  async raspunsPierdut(M) {
    const { apeluri, jurnal } = await ruleaza(M, 150, { handler: () => { throw new Error('timeout') } })
    const w = jurnal.find(j => j.nume === 'fn_red_fan_rezultate')
    return apeluri.filter(a => a.cale === '/intern-awb').length === 1 && w.args.p_rezultate.every(x => x.stare === 'necunoscut')
  },
  async raspunsPartial(M) {
    // asimetric: primul respins, apoi două AWB-uri → asocierea pe poziție se vede (r0000 = eroare, r0002 = 3000000003)
    const { jurnal } = await ruleaza(M, 3, { handler: () => raspuns(200, { response: [{ awbNumber: null, errors: { phone: ['x'] } }, { awbNumber: '3000000002' }, { awbNumber: '3000000003' }] }) })
    return JSON.stringify(jurnal.find(j => j.nume === 'fn_red_fan_rezultate').args.p_rezultate.map(x => [x.id, x.stare, x.awb]))
      === '[["r0000","eroare",null],["r0001","generat","3000000002"],["r0002","generat","3000000003"]]'
  },
  async confirmareNecunoscuta(M) {
    const c = M.fan.interpreteazaConfirmari(200, [{ awbNumber: '3000000001' }, { ceva: 'fara awb' }], ['3000000001', '3000000002'])
    return [...c.pe_awb.values()].every(v => v === 'forma_necunoscuta')
  },
  async lotTest(M) {
    const csv = M.lot.csvBorderouFan({ lot: { nr_lot: 'PP-0001' }, fanLot: { test: true }, randuri: [] })
    return M.lot.prefixLot({ test: true }) === 'TEST_' && /LOT DE TEST/.test(csv) && /^LOT DE TEST/.test(M.lot.titluLot({ nr_lot: 'PP-0001' }, { test: true }))
  },
  async poartaRol(M) {
    const deps = { getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: false }), lot: async () => ({ data: LOT }) }
    return (await M.h.raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT.id } }, deps)).status === 403
  },
  async transportOprit(M) {
    const interzis = vi.fn(() => { throw new Error('APEL INTERZIS') })
    const deps = { getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: async () => ({ data: LOT }),
      fetch: interzis, rpc: interzis, secrete: interzis, randuriLot: interzis, datePlicuri: interzis, proiect: interzis }
    let r
    try { r = await M.h.raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT.id } }, deps) } catch { return false }
    return r.status === 423 && r.body.cod === 'transport_real_oprit' && interzis.mock.calls.length === 0 && M.h.TRANSPORT_REAL_ACTIV === false
      && M.lot.stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, fanLot: { test: false }, randuri: [{ stare: 'aprobat' }], gataDePropus: 1 }).every(p => !p.activ)
  },
}

const MUTANTI = [
  ['limita100', 'limita de 100 ridicată la 1000', { fisier: 'redariFan.mjs', din: 'export const MAX_PE_CERERE = 100', in: 'export const MAX_PE_CERERE = 1000' }],
  ['limita100', 'fără împărțire în bucăți', { fisier: 'redariFanTransport.mjs', din: 'const bucati = imparteInBucati(deTrimis, MAX_PE_CERERE)', in: 'const bucati = deTrimis.length ? [deTrimis.slice(0, 100), deTrimis.slice(100)].filter(b => b.length) : []' }],
  ['idempotenta', 'se trimit și rândurile deja trimise', { fisier: 'redariFanTransport.mjs', din: "const aprobate = randuri.filter(x => x.stare === 'aprobat')", in: "const aprobate = randuri.filter(x => ['aprobat', 'generat', 'in_curs', 'necunoscut'].includes(x.stare))" }],
  ['raspunsPierdut', 'rularea continuă după un răspuns necunoscut', { fisier: 'redariFanTransport.mjs', din: "if (rez.some(x => x.stare === 'necunoscut')) {", in: 'if (false) {' }],
  ['raspunsPierdut', 'timeout tratat ca refuz (eroare)', { fisier: 'redariFan.mjs', din: "if (!Number.isInteger(status) || status >= 500 || status <= 0) return toate('necunoscut'", in: "if (!Number.isInteger(status) || status >= 500 || status <= 0) return toate('eroare'" }],
  ['raspunsPartial', 'elementul respins nu e „eroare”', { fisier: 'redariFan.mjs', din: "if (areErori(r.errors) && !awb) return { stare: 'eroare'", in: "if (false) return { stare: 'eroare'" }],
  ['raspunsPartial', 'asocierea pe poziție inversată', { fisier: 'redariFan.mjs', din: 'const rez = el.map(interpreteazaElement)', in: 'const rez = [...el].reverse().map(interpreteazaElement)' }],
  ['confirmareNecunoscuta', 'elementul fără AWB ignorat', { fisier: 'redariFan.mjs', din: 'if (!lista || lista.some(el => !awbDin(el)))', in: 'if (!lista)' }],
  ['lotTest', 'prefixul TEST_ pierdut', { fisier: 'fanLot.js', din: "fanLot?.test === true ? 'TEST_' : ''", in: "''" }],
  ['lotTest', 'borderoul fără marcaj', { fisier: 'fanLot.js', din: "const cap = fanLot?.test === true ? [['LOT DE TEST", in: "const cap = false ? [['LOT DE TEST" }],
  ['poartaRol', 'fără verificarea owner-ului', { fisier: 'redariFanHandler.mjs', din: "if (owner?.data !== true) return out(403, 'non_owner')", in: '' }],
  ['transportOprit', 'garda 423 scoasă', { fisier: 'redariFanHandler.mjs', din: "if (!TRANSPORT_REAL_ACTIV) return out(423, 'transport_real_oprit')", in: '' }],
  ['transportOprit', 'flag-ul pornit', { fisier: 'redariFanHandler.mjs', din: 'export const TRANSPORT_REAL_ACTIV = false', in: 'export const TRANSPORT_REAL_ACTIV = true' }],
]

describe('mutanți FAN (JS)', () => {
  it('codul real trece TOATE verificările', async () => {
    const M = await incarca(null)
    for (const [nume, f] of Object.entries(VERIFICARI)) expect([nume, await f(M)]).toEqual([nume, true])
  })
  it.each(MUTANTI.map(([v, nume, ...m]) => [nume, v, m]))('mutantul „%s” e prins de verificarea %s', async (_, verificare, mutatii) => {
    // mutanții cu două modificări se aplică pe rând în același folder
    let M
    if (mutatii.length === 1) M = await incarca(mutatii[0])
    else {
      const dir = mkdtempSync(join(TMP, 'fan_mutant_')); foldere.push(dir)
      for (const [nume, text] of Object.entries(SURSE)) {
        let t = text
        for (const mu of mutatii) if (mu.fisier === nume) { expect(t.split(mu.din).length).toBe(2); t = t.replace(mu.din, mu.in) }
        writeFileSync(join(dir, nume), t)
      }
      const m = n => import(pathToFileURL(join(dir, n)).href)
      M = { fan: await m('redariFan.mjs'), tr: await m('redariFanTransport.mjs'), h: await m('redariFanHandler.mjs'), lot: await m('fanLot.js') }
    }
    // o excepție pe codul mutat = comportament diferit (ex. a doua gardă, interpreteazaRaspunsLot refuză > 100) → mutant prins
    let rez
    try { rez = await VERIFICARI[verificare](M) } catch { rez = false }
    expect(rez).toBe(false)
  })
})
