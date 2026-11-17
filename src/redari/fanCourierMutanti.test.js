// Mutanți pe codul FAN (JS): fiecare verificare trebuie să TREACĂ pe codul real și să PICE pe codul mutat — altfel testul nu păzește regula.
// Mutanții pe SQL (limita de 100 la claim, idempotența, plafonul pilot, lotul de test, poarta owner) sunt în proba PGlite a migrării
// (scripts/pglite/test_redari_fan_awb_local.mjs). Modulele se copiază într-un folder temporar (cu mutația) și se importă de acolo.
// Runda 2 (verdictul Jakarinos pe #1118, head 31f0473d): verificările noi (reconcilierea, manifestul comun, ștergerea, marcajul, operațiile din
// ecran, motivele fără PII, numele din arhivă, amprenta surselor, versiunea urmăririi, referința pe element) rulează și pe sursele de la
// 31f0473d (git show), unde TREBUIE să pice — dovada că testele noi păzesc constatările (se sare dacă istoricul nu are commitul).
import { describe, it, expect, vi, afterAll } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const CAI = {
  'redariFan.mjs': 'supabase/functions/_shared/redariFan.mjs',
  'redariFanTransport.mjs': 'supabase/functions/_shared/redariFanTransport.mjs',
  'redariFanHandler.mjs': 'supabase/functions/_shared/redariFanHandler.mjs',
  'fanLot.js': 'src/redari/fanLot.js',
  'plicuri.js': 'src/redari/plicuri.js',
}
// importurile relative ale modulelor copiate: handler-ul lângă fanLot, setari.js din arborele de lucru (neschimbat de această livrare)
const SETARI = pathToFileURL(resolve('src/redari/setari.js')).href
const adapteaza = (nume, t) => nume === 'fanLot.js' ? t.replace("'../../supabase/functions/_shared/redariFanHandler.mjs'", "'./redariFanHandler.mjs'")
  : nume === 'plicuri.js' ? t.replace("'./setari.js'", `'${SETARI}'`) : t
const SURSE = Object.fromEntries(Object.entries(CAI).map(([n, c]) => [n, adapteaza(n, readFileSync(c, 'utf8'))]))
const VECHI = '31f0473d589fff7197785973eff6d301e4f455b0'
const surseVechi = (() => {
  try { return Object.fromEntries(Object.entries(CAI).map(([n, c]) => [n, adapteaza(n, execFileSync('git', ['show', `${VECHI}:${c}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))])) }
  catch { return null }
})()
// folderul temporar stă în .tmp/ (ignorat de git): pe Windows, calea scurtă din %TEMP% (GAZPET~1) nu se încarcă prin vite
const TMP = join(process.cwd(), '.tmp')
mkdirSync(TMP, { recursive: true })
const foldere = []
afterAll(() => { for (const f of foldere) rmSync(f, { recursive: true, force: true }) })
async function incarca(mutatie, surse = SURSE) {
  const dir = mkdtempSync(join(TMP, 'fan_mutant_'))
  foldere.push(dir)
  for (const [nume, text] of Object.entries(surse)) {
    let t = text
    if (mutatie && mutatie.fisier === nume) {
      if (t.split(mutatie.din).length !== 2) throw new Error(`mutația nu se aplică exact o dată în ${nume}: ${mutatie.din}`)
      t = t.replace(mutatie.din, mutatie.in)
    }
    writeFileSync(join(dir, nume), t)
  }
  const m = n => import(pathToFileURL(join(dir, n)).href)
  return { fan: await m('redariFan.mjs'), tr: await m('redariFanTransport.mjs'), h: await m('redariFanHandler.mjs'), lot: await m('fanLot.js'), pl: await m('plicuri.js') }
}

// ── fixtura comună: plicuri fictive + FAN simulat ──
const LOT = { id: '11111111-2222-4333-8444-555555555555', proiect_id: 'p1', nr_lot: 'PP-0001' }
const contact = { telefon: '0700000001', adresa_strada: 'Str. Fictivă 1', adresa_sat: 'Sat', adresa_judet: 'Prahova' }
const raspuns = (status, corp) => ({ status, json: async () => corp, arrayBuffer: async () => new ArrayBuffer(0) })
async function ruleaza(M, n, { stari = {}, handler, corp = { actiune: 'genereaza' }, randuriPlus = {}, rpc }) {
  const plicuri = Array.from({ length: n }, (_, i) => ({ id: `pl${i + 1}`, nr_plic: `PL-TST-${String(i + 1).padStart(4, '0')}`, destinatar_nume: 'PERSOANA FICTIVA', stare: 'activ' }))
  const convocari = plicuri.map((p, i) => ({ id: `c${i}`, plic_id: p.id, detinator_id: `d${i}` }))
  const contacte = plicuri.map((p, i) => ({ detinator_id: `d${i}`, ...contact }))
  const pr = await M.fan.pregatestePlicuriFan({ plicuri, convocari, contacte, proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
  const randuri = pr.map((x, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, plic_id: x.plic.id, nr_plic: x.plic.nr_plic, stare: stari[i] || 'aprobat',
    hash_date: x.hash, awb: null, versiune_urmarire: 7, ...(randuriPlus[i] || {}) }))
  const apeluri = [], jurnal = []
  const fetch = async (url, init) => {
    const u = new URL(url)
    if (u.pathname === '/login') return raspuns(200, { data: { token: 't' } })
    apeluri.push({ cale: u.pathname, metoda: init.method, corp: init.body ? JSON.parse(init.body) : null, q: u.searchParams })
    return handler(u, init, apeluri)
  }
  const deps = {
    secrete: () => ({ username: 'u', password: 'p', clientId: 'C' }), randuriLot: async () => ({ data: randuri }), proiect: async () => ({ data: { cod: 'TEST-RAZVAN' } }),
    datePlicuri: async () => ({ data: { plicuri, convocari, contacte } }), plicuriLot: async () => ({ data: plicuri }), pauza: async () => {}, subtle: webcrypto.subtle, fetch,
    rpc: rpc || (async (nume, args) => { jurnal.push({ nume, args }); return nume === 'fn_red_fan_claim_lot' ? { data: '99999999-0000-4000-8000-000000000001' }
      : ['fn_red_fan_urmarire', 'fn_red_fan_confirmari'].includes(nume) ? { data: { scrise: args.p_randuri.length, depasite: 0 } } : { data: (args.p_rezultate || args.p_randuri || []).length } }),
  }
  const r = await M.tr.executaActiuneFan({ corp, lot: LOT }, deps)
  return { r, apeluri, jurnal, plicuri, convocari, contacte, randuri }
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
    return JSON.stringify(jurnal.find(j => j.nume === 'fn_red_fan_rezultate').args.p_rezultate.map(x => [x.id.slice(-1), x.stare, x.awb]))
      === '[["0","eroare",null],["1","generat","3000000002"],["2","generat","3000000003"]]'
  },
  // ── runda 2 (verdictul #1118); fiecare PICĂ pe 31f0473d ──
  // 1 (P1): un element de borderou neinterpretabil (AWB valid, referința într-un câmp necunoscut) + pagina goală ≠ „lipsa” — mutantul recenzentului
  async reconciliereNeinterpretabil(M) {
    const g = M.fan.cautaInBorderou([{ data: [{ awbNumber: '3000000001', reference: 'PL-TST-0001' }] }, { data: [] }], ['PL-TST-0001'], { complet: true })
    const { r } = await ruleaza(M, 1, { stari: { 0: 'necunoscut' }, corp: { actiune: 'reconciliaza', data: '2026-11-17' },
      handler: u => raspuns(200, { data: u.searchParams.get('page') === '1' ? [{ awbNumber: '3000000001', reference: 'PL-TST-0001' }] : [] }) })
    return g.get('PL-TST-0001').stare === 'de_verificat' && r.body.propuneri[0].stare === 'de_verificat' && r.body.propuneri[0].stare !== 'lipsa'
  },
  // 2 (P1): plicurile 1-2-3, al 2-lea respins → etichetele ȘI arhiva documentelor = 1, 3 (aceleași poziții), pagina de control numește plicul 2
  async manifestComun(M) {
    const pdf = new TextEncoder().encode('%PDF-1.7 x')
    const pl = [1, 2, 3].map(i => ({ id: `pl${i}`, nr_plic: `PL-TST-000${i}`, stare: 'activ', opis_path: `o${i}`, destinatar_nume: 'PERSOANA FICTIVA' }))
    const rd = [{ id: 'a', plic_id: 'pl1', nr_plic: 'PL-TST-0001', stare: 'generat', awb: '3000000001' }, { id: 'b', plic_id: 'pl2', nr_plic: 'PL-TST-0002', stare: 'eroare', awb: null },
      { id: 'c', plic_id: 'pl3', nr_plic: 'PL-TST-0003', stare: 'generat', awb: '3000000003' }]
    const man = M.fan.manifestTiparire({ randuri: rd, plicuri: pl })
    const { r, apeluri } = await ruleaza(M, 3, { stari: { 0: 'generat', 1: 'eroare', 2: 'generat' }, randuriPlus: { 0: { awb: '3000000001' }, 2: { awb: '3000000003' } },
      corp: { actiune: 'eticheta', manifest_cheie: '1:PL-TST-0001:3000000001|2:PL-TST-0003:3000000003' }, handler: () => ({ status: 200, arrayBuffer: async () => pdf.buffer }) })
    const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `f${p.id}` }]]))
    const zip = M.pl.planPachetPlicuire(pl, cv, { manifest: man })
    const eticheta = apeluri.find(a => a.cale === '/awb/label')?.q.getAll('awbs[]')
    return JSON.stringify(eticheta) === '["3000000001","3000000003"]' && JSON.stringify(r.body.pozitii) === '[1,2]' && JSON.stringify(man.ramase.map(x => x.nr_plic)) === '["PL-TST-0002"]'
      && JSON.stringify([...new Set(zip.fisiere.map(f => f.nr_plic))]) === '["PL-TST-0001","PL-TST-0003"]' && zip.fisiere.every(f => f.nume.startsWith(f.nr_plic === 'PL-TST-0001' ? '0001_' : '0002_'))
  },
  // 3 (P2): DELETE /awb cu 200 + eroare (sau formă necunoscută) → AWB-ul rămâne, nicio anulare scrisă
  async stergereStricta(M) {
    for (const corp of [{ status: 'error', message: 'nu' }, null, { ceva: 1 }]) {
      const { r, jurnal } = await ruleaza(M, 1, { stari: { 0: 'generat' }, randuriPlus: { 0: { awb: '3000000001' } }, corp: { actiune: 'sterge_awb', rand_id: '00000000-0000-4000-8000-000000000000' },
        handler: () => raspuns(200, corp) })
      if (r.body.cod !== 'stergere_neconfirmata' || jurnal.some(j => j.nume === 'fn_red_fan_anulat')) return false
    }
    const { r } = await ruleaza(M, 1, { stari: { 0: 'generat' }, randuriPlus: { 0: { awb: '3000000001' } }, corp: { actiune: 'sterge_awb', rand_id: '00000000-0000-4000-8000-000000000000' },
      handler: () => raspuns(200, { status: 'success' }) })
    return r.body.cod === 'ok'
  },
  // 4 (P2): marcajul TEST / real blocat după PRIMA aprobare, chiar dacă rândurile au redevenit „propus”
  async marcajIstoric(M) {
    return M.lot.stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'propus' }], fanLot: { test: false, prima_aprobare_la: '2026-11-17T10:00:00Z' } }).activ === false
      && M.lot.stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'propus' }], fanLot: { test: false, prima_aprobare_la: null } }).activ === true
  },
  // 5 (P2): operațiile procedurii (reconciliere, plafon, anulare, evenimente) există și sunt dezactivate cu transportul oprit
  async operatiiEcran(M) {
    const o = M.lot.stariOperatii({ evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'necunoscut' }, { stare: 'generat' }] })
    const p = M.lot.stariOperatii({ transportActiv: true, evidentaInstalata: true, esteOwner: true, randuri: [{ stare: 'necunoscut' }, { stare: 'generat' }] })
    return JSON.stringify(o.map(x => x.cheie)) === '["reconciliere","plafon","anulare","evenimente"]' && o.every(x => !x.activ) && p.every(x => x.activ)
  },
  // 6 (P2): mesajul FAN (cu valoarea respinsă) nu ajunge în motiv; doar câmpul din lista albă
  async motivFaraPii(M) {
    const r = M.fan.interpreteazaRaspunsLot(200, { response: [{ awbNumber: null, errors: { 'recipient.phone': ['Telefonul 0712345678 nu e valid'], 'Str. Fictiva 9': ['x'] } }] }, 1)[0]
    return r.stare === 'eroare' && /phone/.test(r.motiv) && !/0712345678|Fictiva|valid/.test(r.motiv)
  },
  // 7 (P2): numele din arhivă, sortate lexical = ordinea de tipărire (plic 4 cifre, document 3 cifre)
  async numeArhiva(M) {
    const pl = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, nr_plic: `PL-TST-${String(i + 1).padStart(4, '0')}`, stare: 'activ', opis_path: `o${i}` }))
    const cv = { p0: Array.from({ length: 12 }, (_, k) => ({ conv_id: `c${k}`, nr_document: `C-${String(k + 1).padStart(6, '0')}`, fisier_convocator_path: `f${k}` })) }
    for (const p of pl.slice(1)) cv[p.id] = [{ conv_id: `x${p.id}`, nr_document: 'C-000100', fisier_convocator_path: `g${p.id}` }]
    const nume = M.pl.planPachetPlicuire(pl, cv).fisiere.map(f => f.nume)
    return JSON.stringify(nume) === JSON.stringify([...nume].sort()) && nume[0].startsWith('0001_PL-TST-0001_000_opis')
  },
  // 8a: claim-ul primește amprenta SURSELOR (aceeași funcție ca SQL-ul), pe fiecare rând
  async surseLaClaim(M) {
    const { jurnal, plicuri, convocari, contacte } = await ruleaza(M, 2, { handler: toateOk })
    const c = jurnal.find(j => j.nume === 'fn_red_fan_claim_lot')
    const a = await M.fan.amprenteSurse({ plicuri, convocari, contacte, proiectCod: 'TEST-RAZVAN', subtle: webcrypto.subtle })
    return Array.isArray(c?.args.p_surse) && JSON.stringify(c.args.p_surse) === JSON.stringify(plicuri.map(p => a.get(p.id))) && c.args.p_surse.every(s => /^[0-9a-f]{64}$/.test(s))
  },
  // 8b: urmărirea trimite versiunea CITITĂ a fiecărui rând (CAS în BD); scrierea fără forma {scrise, depasite} = neconfirmată
  async versiuneUrmarire(M) {
    const ev = u => raspuns(200, { data: u.searchParams.getAll('awb[]').map(a => ({ awbNumber: a, events: [{ id: 'C0', date: '2026-11-10 15:00:00' }] })) })
    const { r, jurnal } = await ruleaza(M, 2, { stari: { 0: 'generat', 1: 'generat' }, randuriPlus: { 0: { awb: '3000000001' }, 1: { awb: '3000000002' } }, corp: { actiune: 'urmarire' }, handler: ev })
    const p = jurnal.find(j => j.nume === 'fn_red_fan_urmarire')?.args.p_randuri || []
    const vechi = await ruleaza(M, 1, { stari: { 0: 'generat' }, randuriPlus: { 0: { awb: '3000000001' } }, corp: { actiune: 'urmarire' }, handler: ev, rpc: async () => ({ data: 1 }) })
    return p.length === 2 && p.every(x => x.versiune === 7) && r.body.cod === 'ok' && vechi.r.body.cod === 'scriere_neconfirmata'
  },
  // 8c: un element de răspuns cu referința ALTUI plic → toată bucata „necunoscut” (asocierea pe poziție nu se face)
  async referintaContrazisa(M) {
    const rez = M.fan.interpreteazaRaspunsLot(200, { response: [{ awbNumber: '3000000002', info: { observation: 'PL-TST-0002' } }, { awbNumber: '3000000001', info: { observation: 'PL-TST-0001' } }] },
      2, { referinte: ['PL-TST-0001', 'PL-TST-0002'] })
    const bun = M.fan.interpreteazaRaspunsLot(200, { response: [{ awbNumber: '3000000001', info: { observation: 'PL-TST-0001' } }, { awbNumber: '3000000002' }] }, 2, { referinte: ['PL-TST-0001', 'PL-TST-0002'] })
    // și pe calea reală: răspunsul cu referințele inversate → rezultatele scrise = „necunoscut”
    const { jurnal } = await ruleaza(M, 2, { handler: () => raspuns(200, { response: [{ awbNumber: '3000000002', info: { observation: 'PL-TST-0002' } }, { awbNumber: '3000000001', info: { observation: 'PL-TST-0001' } }] }) })
    const scrise = jurnal.find(j => j.nume === 'fn_red_fan_rezultate')?.args.p_rezultate.map(x => x.stare).join()
    return rez.every(x => x.stare === 'necunoscut') && bun.map(x => x.asociere).join() === 'referinta,pozitie' && scrise === 'necunoscut,necunoscut'
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
  ['raspunsPartial', 'asocierea pe poziție inversată', { fisier: 'redariFan.mjs', din: 'const rez = el.map(e => ({', in: 'const rez = [...el].reverse().map(e => ({' }],
  // runda 2
  ['reconciliereNeinterpretabil', 'elementul fără referință cunoscută sărit tacit (forma 31f0473d)', { fisier: 'redariFan.mjs', din: 'if (!awb || !refs.length) { neinterpretabile++; continue }', in: 'if (!awb || !refs.length) continue' }],
  ['reconciliereNeinterpretabil', 'neinterpretabilele ignorate la concluzie', { fisier: 'redariFan.mjs', din: '  if (neinterpretabile) return Object.assign(tot(', in: '  if (false) return Object.assign(tot(' }],
  ['manifestComun', 'arhiva ignoră manifestul (toate plicurile active)', { fisier: 'plicuri.js', din: 'const lista = manifest ? manifest.tiparite', in: 'const lista = false ? manifest.tiparite' }],
  ['manifestComun', 'manifestul tipărește și plicurile fără AWB', { fisier: 'redariFan.mjs', din: 'else ramase.push({ plic_id: p.id, nr_plic: p.nr_plic, motiv:',
    in: "else tiparite.push({ pozitie: tiparite.length + 1, plic_id: p.id, nr_plic: p.nr_plic, awb: '', rand_id: null, motiv:" }],
  ['stergereStricta', 'orice 2xx = șters (forma 31f0473d)', { fisier: 'redariFan.mjs', din: "if (status === 200 && obiect && corp.status === 'success'", in: "if (true || status === 200 && obiect && corp.status === 'success'" }],
  ['marcajIstoric', 'marcajul blocat doar după stările curente', { fisier: 'fanLot.js', din: '  if (fanLot?.prima_aprobare_la) return', in: '  if (false) return' }],
  ['operatiiEcran', 'operațiile active cu transportul oprit', { fisier: 'fanLot.js', din: 'if (oprit) return { ...p, activ: false, motiv: oprit }', in: 'if (false) return null' }],
  ['motivFaraPii', 'mesajul FAN copiat în motiv (forma 31f0473d)', { fisier: 'redariFan.mjs', din: "return { stare: 'eroare', motiv: motivRefuzFan(r.errors) }", in: "return { stare: 'eroare', motiv: 'FAN: ' + JSON.stringify(r.errors).slice(0, 300) }" }],
  ['motivFaraPii', 'cheile citite fără lista albă', { fisier: 'redariFan.mjs', din: 'if (CAMP_EROARE.has(seg)) gasite.add(seg)', in: 'gasite.add(seg)' }],
  ['numeArhiva', 'documentul pe o singură cifră', { fisier: 'plicuri.js', din: 'export const CIFRE_PLIC = 4, CIFRE_DOCUMENT = 3', in: 'export const CIFRE_PLIC = 4, CIFRE_DOCUMENT = 1' }],
  ['numeArhiva', 'plicul pe 3 cifre (forma 31f0473d)', { fisier: 'plicuri.js', din: 'export const CIFRE_PLIC = 4, CIFRE_DOCUMENT = 3', in: 'export const CIFRE_PLIC = 3, CIFRE_DOCUMENT = 3' }],
  ['surseLaClaim', 'claim fără amprenta surselor', { fisier: 'redariFanTransport.mjs', din: ', p_surse: b.map(x => x.surse) })', in: ' })' }],
  ['versiuneUrmarire', 'urmărirea fără versiunea citită', { fisier: 'redariFanTransport.mjs', din: 'return { id: r.id, awb: r.awb, versiune: r.versiune_urmarire, urmarire_stare', in: 'return { id: r.id, awb: r.awb, urmarire_stare' }],
  ['versiuneUrmarire', 'orice răspuns al BD acceptat ca scriere', { fisier: 'redariFanTransport.mjs', din: "const rezScriere = (w, n) => !w?.error && w?.data && typeof w.data === 'object'", in: "const rezScriere = (w, n) => ({ scrise: n, depasite: 0 }) || !w?.error && w?.data && typeof w.data === 'object'" }],
  ['referintaContrazisa', 'referința din răspuns ignorată (doar poziția)', { fisier: 'redariFan.mjs', din: '    if (gresit >= 0) return toate(', in: '    if (false) return toate(' }],
  ['referintaContrazisa', 'transportul nu trimite referințele', { fisier: 'redariFanTransport.mjs', din: ', { referinte: b.map(x => x.rand.nr_plic) })', in: ')' }],
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
      M = { fan: await m('redariFan.mjs'), tr: await m('redariFanTransport.mjs'), h: await m('redariFanHandler.mjs'), lot: await m('fanLot.js'), pl: await m('plicuri.js') }
    }
    // o excepție pe codul mutat = comportament diferit (ex. a doua gardă, interpreteazaRaspunsLot refuză > 100) → mutant prins
    let rez
    try { rez = await VERIFICARI[verificare](M) } catch { rez = false }
    expect(rez).toBe(false)
  })
  // runda 2: aceleași verificări noi pe codul revizuit (31f0473d) TREBUIE să pice — altfel nu păzesc constatarea
  const NOI = ['reconciliereNeinterpretabil', 'manifestComun', 'stergereStricta', 'marcajIstoric', 'operatiiEcran', 'motivFaraPii', 'numeArhiva', 'surseLaClaim', 'versiuneUrmarire', 'referintaContrazisa']
  it.skipIf(!surseVechi).each(NOI)('pe 31f0473d verificarea nouă „%s” PICĂ (constatarea era reală)', async v => {
    const M = await incarca(null, surseVechi)
    let rez
    try { rez = await VERIFICARI[v](M) } catch { rez = false }
    expect(rez).toBe(false)
  })
})
