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
import { pasiDinDocument, parcurge, lumeNoua } from './fanProcedura.testutil.js'

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
  .replace("'../../supabase/functions/_shared/redariFan.mjs'", "'./redariFan.mjs'")
  : nume === 'plicuri.js' ? t.replace("'./setari.js'", `'${SETARI}'`) : t
const SURSE = Object.fromEntries(Object.entries(CAI).map(([n, c]) => [n, adapteaza(n, readFileSync(c, 'utf8'))]))
const surseDin = sha => {
  try { return Object.fromEntries(Object.entries(CAI).map(([n, c]) => [n, adapteaza(n, execFileSync('git', ['show', `${sha}:${c}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))])) }
  catch { return null }
}
const VECHI = '31f0473d589fff7197785973eff6d301e4f455b0'
const surseVechi = surseDin(VECHI)
// runda 3: head-ul revizuit în runda 2 (verdictul Jakarinos #1118 r2)
const VECHI_R2 = '0716f5b3a67ad43ba9b537c9e03835c2df6115a6'
const surseR2 = surseDin(VECHI_R2)
// runda 4: head-ul revizuit în runda 3 (verdictul Jakarinos #1118 r3)
const VECHI_R3 = 'fdaa0496171a95d65644c49e17d033c07c1a3457'
const surseR3 = surseDin(VECHI_R3)
// activare, runda 2 (verdictul Jakarinos pe PR #1130): procedura zilei din 9ceea228 (plafon înaintea marcajului, „Propune” înaintea „Marchează TEST”)
// TREBUIE să pice în simulatorul procedurii; runda 3 (al doilea verdict): documentul din 9fb88b2f trece pe primul plic, dar continuarea cu trei
// plicuri („aceiași pași de la §5 la §8”) TREBUIE să pice pe istoricul primului lot; documentul curent trece COMPLET (primul plic → lotul de 3 → încheierea)
const DOC_PASI = 'docs/redari/FAN_TEST1_PASI.md'
const PASI_ACUM = readFileSync(DOC_PASI, 'utf8')
const docDin = sha => { try { return execFileSync('git', ['show', `${sha}:${DOC_PASI}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return null } }
const PASI_VECHI = docDin('9ceea22800da3cce3c4c072a7314c67cb974c827')
const PASI_R2 = docDin('9fb88b2f0cfd897375271ac93be6768cae69dd7f')
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
// fn_red_fan_tiraj / _opreste SIMULATE după contractul din migrare (semantica SQL e probată pe PGlite); `stare` = rândul lotului, comun
// descărcărilor; runda 4: oprirea (RD021 la orice descărcare) și înlocuirea doar după oprire + 30 s (RD022), ceasul = stare.acum
function tirajSimulat(stare = { cheie: null, nr: 0, la: null }) {
  const acum = () => stare.acum ?? Date.now()
  const rasp = s => ({ data: { stare: s, cheie: stare.cheie, nr: stare.nr, inceput_la: stare.la, oprit_la: stare.oprit_la ?? null } })
  const rd = code => ({ error: { code, message: `redari fan: refuz ${code}` } })
  const f = args => {
    if (args.p_inlocuieste == null) {
      if (stare.oprit_la) return rd('RD021')
      if (stare.cheie && stare.cheie === args.p_cheie) return rasp('acelasi')
      if (stare.cheie == null) { Object.assign(stare, { cheie: args.p_cheie, nr: stare.nr + 1, la: '2026-11-17T16:05:00+00:00' }); return rasp('inceput') }
      return rd('RD020')
    }
    if (args.p_inlocuieste !== stare.cheie) return rd('RD020')
    if (args.p_cheie === stare.cheie) return rasp('acelasi')
    if (!stare.oprit_la || acum() - Date.parse(stare.oprit_la) < 30000) return rd('RD022')
    Object.assign(stare, { cheie: args.p_cheie, nr: stare.nr + 1, la: '2026-11-17T16:05:00+00:00', oprit_la: null })
    return rasp('inlocuit')
  }
  f.opreste = args => {
    if (args.p_cheie !== stare.cheie) return rd('RD020')
    stare.oprit_la = args.p_opreste ? (stare.oprit_la || new Date(acum()).toISOString()) : null
    return { data: { stare: stare.oprit_la ? 'oprit' : 'reluat', cheie: stare.cheie, nr: stare.nr, oprit_la: stare.oprit_la } }
  }
  return f
}
// owner-ul, în ALTĂ sesiune: oprește tirajul curent și (opțional) îl înlocuiește după 30 s
const schimbaTirajul = (stare, cheieNoua) => {
  const t = tirajSimulat(stare), vechi = stare.cheie
  stare.acum = Date.parse('2026-11-17T17:00:00Z')
  t.opreste({ p_cheie: vechi, p_opreste: true })
  if (cheieNoua) { stare.acum += 30000; t({ p_cheie: cheieNoua, p_inlocuieste: vechi }) }
}
async function ruleaza(M, n, { stari = {}, handler, corp = { actiune: 'genereaza' }, randuriPlus = {}, rpc, stareTiraj, raspUrmarire }) {
  const tiraj = tirajSimulat(stareTiraj)
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
      : nume === 'fn_red_fan_tiraj' ? tiraj(args) : nume === 'fn_red_fan_tiraj_opreste' ? tiraj.opreste(args)
      : nume === 'fn_red_fan_urmarire' ? (raspUrmarire ? raspUrmarire(args) : { data: { scrise: args.p_randuri.length, pastrate: 0, depasite: 0 } })
      : nume === 'fn_red_fan_confirmari' ? { data: { scrise: args.p_randuri.length, depasite: 0 } } : { data: (args.p_rezultate || args.p_randuri || []).length } }),
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
    return M.lot.stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', randuri: [{ stare: 'propus' }], fanLot: { test: false, prima_aprobare_la: '2026-11-17T10:00:00Z' } }).activ === false
      && M.lot.stareMarcaj({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', randuri: [{ stare: 'propus' }], fanLot: { test: false, prima_aprobare_la: null } }).activ === true
  },
  // 5 (P2): operațiile procedurii (reconciliere, plafon, anulare, evenimente) există și sunt dezactivate cu transportul oprit
  async operatiiEcran(M) {
    const o = M.lot.stariOperatii({ transportActiv: false, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: [{ stare: 'necunoscut' }, { stare: 'generat' }] })
    const p = M.lot.stariOperatii({ transportActiv: true, evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: [{ stare: 'necunoscut' }, { stare: 'generat' }] })
    // runda 5: „solutionare” cere o contradicție (aici niciuna) — verificată separat (fanCourier.test.js)
    return JSON.stringify(o.map(x => x.cheie).filter(k => !['tiraj', 'solutionare'].includes(k))) === '["reconciliere","plafon","anulare","evenimente"]' && o.every(x => !x.activ)
      && p.filter(x => x.cheie !== 'solutionare').every(x => x.activ)
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
  // ── runda 3 (verdictul #1118 r2); fiecare PICĂ pe 0716f5b3 ──
  // r2 P1, scenariul recenzentului: etichete pentru 1, 3 (2 respins) → tirajul începe; apoi 2 rezolvat → arhiva (și o parte nouă de etichete)
  // cu manifestul 1, 2, 3 = REFUZ RD020 / 409, nicio etichetă cerută; arhiva în starea tirajului trece, cu identificatorul în nume.
  async tirajComun(M) {
    const pdf = new TextEncoder().encode('%PDF-1.7 x')
    const st = { cheie: null, nr: 0, la: null }
    const lbl = () => ({ status: 200, arrayBuffer: async () => pdf.buffer })
    const a = await ruleaza(M, 3, { stari: { 0: 'generat', 1: 'eroare', 2: 'generat' }, randuriPlus: { 0: { awb: '3000000001' }, 2: { awb: '3000000003' } },
      corp: { actiune: 'eticheta', manifest_cheie: '1:PL-TST-0001:3000000001|2:PL-TST-0003:3000000003' }, handler: lbl, stareTiraj: st })
    const id = a.r.body.tiraj.id
    const arhiva = async x => {
      const pl = x.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
      const cv = Object.fromEntries(pl.map(p => [p.id, [{ conv_id: `c${p.id}`, nr_document: 'C-000001', fisier_convocator_path: `f/${p.id}` }]]))
      const t = tirajSimulat(st)
      try { return await M.lot.pregatestePachetFan({ rpc: async (n, y) => t(y), lot: LOT, fanLot: { test: false }, randuriFan: x.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle }) }
      catch (e) { return { refuz: e?.code || 'exceptie' } }
    }
    const inStareaTirajului = await arhiva(a)
    const b = await ruleaza(M, 3, { stari: { 0: 'generat', 1: 'generat', 2: 'generat' }, randuriPlus: { 0: { awb: '3000000001' }, 1: { awb: '3000000002' }, 2: { awb: '3000000003' } },
      corp: { actiune: 'eticheta', manifest_cheie: '1:PL-TST-0001:3000000001|2:PL-TST-0002:3000000002|3:PL-TST-0003:3000000003' }, handler: lbl, stareTiraj: st })
    const dupa = await arhiva(b)
    return a.r.body.cod === 'ok' && /^[0-9A-F]{8}$/.test(id) && st.nr === 1
      && inStareaTirajului.tiraj?.id === id && inStareaTirajului.plan.fisiere.length === 4 && inStareaTirajului.plan.fisiere.every(f => f.nume.endsWith(`_T${id}.docx`))
      && b.r.body.cod === 'tiraj_schimbat' && b.apeluri.filter(x => x.cale === '/awb/label').length === 0 && dupa.refuz === 'RD020'
  },
  // r2 P1: pagina de control din etichete = cea din arhivă (inclusiv numărul documentelor), cu tirajul în loc de data zilei; valorile scrise de mână
  async controlIdentic(M) {
    const pdf = new TextEncoder().encode('%PDF-1.7 x')
    const st = { cheie: null, nr: 0, la: null }
    const a = await ruleaza(M, 3, { stari: { 0: 'generat', 1: 'eroare', 2: 'generat' }, randuriPlus: { 0: { awb: '3000000001' }, 2: { awb: '3000000003' } },
      corp: { actiune: 'eticheta', manifest_cheie: '1:PL-TST-0001:3000000001|2:PL-TST-0003:3000000003' }, handler: () => ({ status: 200, arrayBuffer: async () => pdf.buffer }), stareTiraj: st })
    const pl = a.plicuri.map(p => ({ ...p, opis_path: `o/${p.id}` }))
    const cv = { pl1: [{ conv_id: 'c1', nr_document: 'C-000001', fisier_convocator_path: 'f1' }, { conv_id: 'c2', nr_document: 'C-000002', fisier_convocator_path: 'f2' }],
      pl2: [{ conv_id: 'c3', nr_document: 'C-000003', fisier_convocator_path: 'f3' }], pl3: [{ conv_id: 'c4', nr_document: 'C-000004', fisier_convocator_path: 'f4' }] }
    const man = M.fan.manifestTiparire({ randuri: a.randuri, plicuri: pl })
    const tiraj = a.r.body.tiraj, id = tiraj.id
    const dinEtichete = M.lot.controlLotFan({ lot: LOT, fanLot: { test: false }, manifest: man, plicuri: pl, convocariPePlic: cv, tiraj }).continut
    const t = tirajSimulat(st)
    const dinArhiva = (await M.lot.pregatestePachetFan({ rpc: async (n, y) => t(y), lot: LOT, fanLot: { test: false }, randuriFan: a.randuri, plicuri: pl, convocariPePlic: cv, subtle: webcrypto.subtle })).continut
    const asteptat = [['0001', 'PL-TST-0001', '3000000001', 'PE****** FI*****', 3, '☐'], ['0002', 'PL-TST-0003', '3000000003', 'PE****** FI*****', 2, '☐']]
    return JSON.stringify(dinEtichete) === JSON.stringify(dinArhiva) && JSON.stringify(dinArhiva.tabel.randuri) === JSON.stringify(asteptat)
      && dinArhiva.paragrafe[0].startsWith(`Tirajul ${id} (nr. 1 al lotului), început la 17.11.2026 18:05`) && dinArhiva.titlu.endsWith(`tirajul ${id}`)
      && !dinArhiva.paragrafe.some(p => p.startsWith('Data:'))
      && M.lot.numeEtichete({ lot: LOT, fanLot: { test: true }, parte: 1, parti: 1, format: 'A6', tiraj }) === `TEST_PP-0001_tiraj-${id}_etichete_A6.pdf`
      && M.lot.numeControl({ lot: LOT, fanLot: { test: false }, tiraj }) === `PP-0001_tiraj-${id}_pagina_de_control.docx`
      && M.lot.numeControl({ lot: LOT, fanLot: { test: false }, tiraj, inArhiva: true }) === `0000_tiraj-${id}_pagina_de_control.docx`
      && M.lot.numeArhiva({ lot: LOT, fanLot: { test: false }, tiraj }) === `PP-0001_tiraj-${id}_documente_in_ordinea_plicurilor.zip`
  },
  // r2 P2: lista lipsă ≠ listă goală; `events: []` = fără cronologie (BD-ul păstrează ce știe: „păstrate”); forma veche a scrierii = neconfirmată
  async urmarireFaraEvenimente(M) {
    const lipsa = M.fan.rezumatUrmarireFan({ awbNumber: '3000000001' })
    const gol = M.fan.rezumatUrmarireFan({ awbNumber: '3000000001', events: [] })
    const baza = { stari: { 0: 'generat' }, randuriPlus: { 0: { awb: '3000000001' } }, corp: { actiune: 'urmarire' },
      handler: u => raspuns(200, { data: u.searchParams.getAll('awb[]').map(x => ({ awbNumber: x, events: [] })) }) }
    const r1 = await ruleaza(M, 1, { ...baza, raspUrmarire: () => ({ data: { scrise: 0, pastrate: 1, depasite: 0 } }) })
    const p = r1.jurnal.find(j => j.nume === 'fn_red_fan_urmarire')?.args.p_randuri[0]
    const r2 = await ruleaza(M, 1, { ...baza, raspUrmarire: () => ({ data: { scrise: 1, depasite: 0 } }) })
    return lipsa.urmarire_stare === 'de_verificat' && gol.urmarire_stare === 'fara_evenimente' && gol.ultim_eveniment_la === null
      && p?.urmarire_stare === 'fara_evenimente' && p.ultim_eveniment_la === null && r1.r.body.cod === 'ok' && r1.r.body.pastrate === 1 && r2.r.body.cod === 'scriere_neconfirmata'
  },
  // ── runda 4 (verdictul #1118 r3); fiecare PICĂ pe fdaa0496 ──
  // r3 P1, scenariul recenzentului: partea 2 cerută pe K1; cât FAN răspunde, owner-ul oprește și înlocuiește cu K2 → nimic livrat (409),
  // după verificare + reverificarea FINALĂ cu aceeași cheie; oprirea singură → 409 „tiraj_oprit”; partea 1 (neschimbată) trece
  async tirajInlocuitInCurs(M) {
    const pdf = new TextEncoder().encode('%PDF-1.7 x')
    const st = { cheie: null, nr: 0, la: null }
    const baza = { stari: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [i, 'generat'])),
      randuriPlus: Object.fromEntries(Array.from({ length: 150 }, (_, i) => [i, { awb: String(3000000001 + i) }])), stareTiraj: st }
    const man = M.fan.manifestTiparire({ randuri: Array.from({ length: 150 }, (_, i) => ({ id: `r${i}`, plic_id: `pl${i + 1}`, stare: 'generat', awb: String(3000000001 + i) })),
      plicuri: Array.from({ length: 150 }, (_, i) => ({ id: `pl${i + 1}`, nr_plic: `PL-TST-${String(i + 1).padStart(4, '0')}`, stare: 'activ' })) })
    const lbl = () => ({ status: 200, arrayBuffer: async () => pdf.buffer })
    const p1 = await ruleaza(M, 150, { ...baza, corp: { actiune: 'eticheta', parte: 1, manifest_cheie: man.cheie }, handler: lbl })
    const p2 = await ruleaza(M, 150, { ...baza, corp: { actiune: 'eticheta', parte: 2, manifest_cheie: man.cheie },
      handler: u => { if (u.pathname === '/awb/label') schimbaTirajul(st, 'b'.repeat(64)); return lbl() } })
    const inlocuit = st.nr === 2 && st.cheie === 'b'.repeat(64)
    const st2 = { cheie: null, nr: 0, la: null }
    await ruleaza(M, 150, { ...baza, stareTiraj: st2, corp: { actiune: 'eticheta', parte: 1, manifest_cheie: man.cheie }, handler: lbl })
    const p3 = await ruleaza(M, 150, { ...baza, stareTiraj: st2, corp: { actiune: 'eticheta', parte: 2, manifest_cheie: man.cheie },
      handler: u => { if (u.pathname === '/awb/label') schimbaTirajul(st2, null); return lbl() } })
    return p1.r.body.cod === 'ok' && inlocuit && p2.r.status === 409 && p2.r.body.cod === 'tiraj_schimbat' && p2.r.body.pdf_base64 === undefined
      && p2.apeluri.filter(x => x.cale === '/awb/label').length === 1 && p2.jurnal.filter(j => j.nume === 'fn_red_fan_tiraj').length === 2
      && p3.r.status === 409 && p3.r.body.cod === 'tiraj_oprit' && p3.r.body.pdf_base64 === undefined
  },
  // r3 P1 în ecran: reverificarea FINALĂ a arhivei / etichetelor (confirmaTirajFinal) — neschimbat = trece; oprit / înlocuit / aceeași cheie cu alt
  // nr. = refuz; plus oprirea refuzată la începutul arhivei
  async arhivaReverificata(M) {
    const k = 'a'.repeat(64), st = { cheie: k, nr: 1, la: '2026-11-17T16:05:00+00:00' }, t = tirajSimulat(st)
    const rpc = async (n, y) => (n === 'fn_red_fan_tiraj_opreste' ? t.opreste(y) : t(y))
    const tiraj = { cheie: k, nr: 1, id: 'AAAAAAAA', inceput_la: st.la }
    const cod = async p => { try { await p; return 'ok' } catch (e) { return e?.code || 'exceptie' } }
    const a = await cod(M.lot.confirmaTirajFinal({ rpc, lot: LOT, tiraj }))
    schimbaTirajul(st, null)
    const b = await cod(M.lot.confirmaTirajFinal({ rpc, lot: LOT, tiraj }))
    st.acum += 30000; t({ p_cheie: 'c'.repeat(64), p_inlocuieste: k })
    const c = await cod(M.lot.confirmaTirajFinal({ rpc, lot: LOT, tiraj }))
    schimbaTirajul(st, k)   // același manifest ca la început, dar tirajul nr. 3
    const d = await cod(M.lot.confirmaTirajFinal({ rpc, lot: LOT, tiraj }))
    return a === 'ok' && b === 'RD021' && c === 'RD020' && d === 'exceptie' && st.nr === 3
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
  // ACTIVARE Testul 1: flag-ul pornit, DAR calea reală DOAR pe un proiect „TEST-…” cu lotul marcat TEST; orice alt lot = 423, fără secrete / rețea
  async doarTest(M) {
    const interzis = vi.fn(() => { throw new Error('APEL INTERZIS') })
    const baza = { getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: async () => ({ data: LOT }), fetch: interzis, rpc: interzis, secrete: interzis, randuriLot: interzis, datePlicuri: interzis }
    const cer = async (cod, test) => { try { return await M.h.raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT.id } }, { ...baza, proiect: async () => ({ data: { id: 'p1', cod } }), fanLot: async () => ({ data: test == null ? null : { test } }) }) } catch { return null } }
    const real = await cer('LOT1-PRUNISOR-JUPA', true), nemarcat = await cer('TEST-RAZVAN', null), marcatReal = await cer('TEST-RAZVAN', false)
    const refuz = r => r?.status === 423 && r.body.cod === 'transport_real_doar_test'
    if (!refuz(real) || !refuz(nemarcat) || !refuz(marcatReal) || interzis.mock.calls.length !== 0) return false
    // lotul de TEST trece de gardă: calea reală începe cu citirea secretelor (lipsă = 503), fără rețea
    const secrete = vi.fn(() => null)
    let ok
    try { ok = await M.h.raspundeFan({ jwt: 'x', corp: { actiune: 'genereaza', lot_id: LOT.id } }, { ...baza, secrete, proiect: async () => ({ data: { id: 'p1', cod: 'TEST-RAZVAN' } }), fanLot: async () => ({ data: { test: true } }) }) } catch { return false }
    return ok.status === 503 && ok.body.cod === 'transport_neconfigurat' && secrete.mock.calls.length === 1 && interzis.mock.calls.length === 0
      && M.h.TRANSPORT_REAL_ACTIV === true && M.h.DOAR_PROIECTE_TEST === true
      && M.lot.stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, proiectCod: 'LOT1-PRUNISOR-JUPA', fanLot: { test: true }, randuri: [{ stare: 'aprobat' }], gataDePropus: 1 }).every(p => !p.activ)
      && M.lot.stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: false }, randuri: [{ stare: 'aprobat' }], gataDePropus: 1 }).every(p => !p.activ)
      && M.lot.stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: [{ stare: 'aprobat' }], gataDePropus: 1 }).some(p => p.activ)
  },
  // ACTIVARE runda 2 + 3 (Jakarinos #1130 P2 / P3): procedura documentului e executabilă din ecran, COMPLET — primul plic (plafon 1), lotul de 3
  // (plafon 3) cu istoricul primului lot prezent, încheierea (plafon 20) — în ordinea scrisă (coloana „Acțiune”). Pică dacă ordinea din COD se
  // schimbă (mutanții de mai jos) sau dacă documentul cere o stare imposibilă / sare o verificare a procedurii.
  async procedura(M, doc = PASI_ACUM) {
    const fn = { stariPasi: M.lot.stariPasi, stareMarcaj: M.lot.stareMarcaj, stariOperatii: M.lot.stariOperatii }
    const lume = lumeNoua()
    const a = parcurge(pasiDinDocument(doc, '## 5.', '## 9.'), fn, { lume, lot: 'PP-xxxx' })
    const b = parcurge(pasiDinDocument(doc, '## 9.', '## 10.'), fn, { lume, lot: 'PP-yyyy', plicuri: 3, respinse: [2] })
    parcurge(pasiDinDocument(doc, '## 10.', '## 11.'), fn, { lume, lot: 'PP-yyyy' })
    return JSON.stringify(a.jurnal[0].inainte) === '["marcaj_test"]' && a.lot.randuri.length === 1 && a.lot.randuri[0].stare === 'generat'
      && JSON.stringify(b.jurnal[0].inainte) === '["marcaj_test"]' && b.lot.randuri.map(r => r.stare).join() === 'generat,eroare,generat' && lume.setari.limita === 20
  },
}

// comutatorul OPRIT (forma de dinaintea activării, obținută prin mutația flag-ului): comportamentul de pe main rămâne neschimbat —
// 423 „transport_real_oprit” pe ORICE acțiune, fără NICIO citire în plus (nici proiectul, nici marcajul), fără secrete / rețea; ecranul tot oprit
describe('comutatorul oprit (TRANSPORT_REAL_ACTIV = false): comportamentul de dinaintea activării, neschimbat', () => {
  it('toate acțiunile → 423 transport_real_oprit, nicio dependență atinsă; pașii din ecran dezactivați cu „transport oprit”', async () => {
    const M = await incarca({ fisier: 'redariFanHandler.mjs', din: 'export const TRANSPORT_REAL_ACTIV = true', in: 'export const TRANSPORT_REAL_ACTIV = false' })
    const interzis = vi.fn(() => { throw new Error('APEL INTERZIS cât transportul e oprit') })
    const deps = { getUser: async () => ({ data: { user: { id: 'u' } } }), owner: async () => ({ data: true }), lot: async () => ({ data: LOT }),
      fetch: interzis, rpc: interzis, secrete: interzis, randuriLot: interzis, datePlicuri: interzis, proiect: interzis, fanLot: interzis, plicuriLot: interzis, pauza: interzis }
    for (const actiune of M.h.ACTIUNI_FAN) {
      const r = await M.h.raspundeFan({ jwt: 'x', corp: { actiune, lot_id: LOT.id, parte: 1, data: '2026-11-18' } }, deps)
      expect([actiune, r]).toEqual([actiune, { status: 423, body: { cod: 'transport_real_oprit' } }])
    }
    expect(interzis).not.toHaveBeenCalled()
    expect(M.h.TRANSPORT_REAL_ACTIV).toBe(false)
    const p = M.lot.stariPasi({ evidentaInstalata: true, esteOwner: true, poateScrie: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: [{ stare: 'aprobat' }], gataDePropus: 1 })
    expect(p.every(x => !x.activ && x.motiv === M.lot.MESAJ_TRANSPORT_OPRIT)).toBe(true)
    expect(M.lot.stariOperatii({ evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN', fanLot: { test: true }, randuri: [{ stare: 'generat' }] }).every(x => !x.activ && x.motiv === M.lot.MESAJ_TRANSPORT_OPRIT)).toBe(true)
    expect(M.lot.stareMarcaj({ evidentaInstalata: true, esteOwner: true, proiectCod: 'TEST-RAZVAN' })).toEqual({ activ: false, motiv: M.lot.MESAJ_TRANSPORT_OPRIT })
  })
})

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
  ['versiuneUrmarire', 'orice răspuns al BD acceptat ca scriere', { fisier: 'redariFanTransport.mjs', din: "const rezUrmarire = (w, n) => !w?.error && w?.data && typeof w.data === 'object'", in: "const rezUrmarire = (w, n) => ({ scrise: n, pastrate: 0, depasite: 0 }) || !w?.error && w?.data && typeof w.data === 'object'" }],
  ['referintaContrazisa', 'referința din răspuns ignorată (doar poziția)', { fisier: 'redariFan.mjs', din: '    if (gresit >= 0) return toate(', in: '    if (false) return toate(' }],
  ['referintaContrazisa', 'transportul nu trimite referințele', { fisier: 'redariFanTransport.mjs', din: ', { referinte: b.map(x => x.rand.nr_plic) })', in: ')' }],
  // runda 3
  ['tirajComun', 'etichetele fără verificarea tirajului (forma 0716f5b3)', { fisier: 'redariFanTransport.mjs', din: "const t = await deps.rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: ct, p_inlocuieste: null })",
    in: "const t = { data: { stare: 'acelasi', cheie: ct, nr: 1, inceput_la: '2026-11-17T16:05:00+00:00' } }" }],
  ['tirajComun', 'arhiva fără verificarea tirajului (forma 0716f5b3)', { fisier: 'fanLot.js', din: "const { data, error } = await rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: cheie, p_inlocuieste: null })",
    in: "const { data, error } = { data: { stare: 'acelasi', cheie, nr: 1, inceput_la: '2026-11-17T16:05:00+00:00' } }" }],
  ['tirajComun', 'documentele din arhivă fără identificatorul tirajului', { fisier: 'plicuri.js', din: "const sufix = tiraj ? `_T${tiraj}` : ''", in: "const sufix = ''" }],
  ['controlIdentic', 'pagina de control fără numărul documentelor (forma 0716f5b3, etichetele)', { fisier: 'fanLot.js', din: 'documente: p.documente })) })', in: "documente: '' })) })" }],
  ['controlIdentic', 'pagina de control cu data zilei în loc de tiraj', { fisier: 'plicuri.js', din: 'tiraj ? `Tirajul ${tiraj.id}', in: 'false ? `Tirajul ${tiraj.id}' }],
  ['controlIdentic', 'numele fișierelor fără tiraj', { fisier: 'fanLot.js', din: "const cuTiraj = tiraj => (tiraj?.id ? `_tiraj-${tiraj.id}` : '')", in: "const cuTiraj = tiraj => ''" }],
  ['urmarireFaraEvenimente', 'lista lipsă = fără evenimente (forma 0716f5b3)', { fisier: 'redariFan.mjs', din: '  if (!Array.isArray(el.events)) return { ...gol', in: '  if (el.events != null && !Array.isArray(el.events)) return { ...gol' },
    { fisier: 'redariFan.mjs', din: '  for (const e of el.events) {', in: '  for (const e of el.events || []) {' }],
  ['urmarireFaraEvenimente', '„păstrate” ignorate în raport', { fisier: 'redariFanTransport.mjs', din: 'scrise += w.scrise; pastrate += w.pastrate; depasite += w.depasite', in: 'scrise += w.scrise; depasite += w.depasite' }],
  // runda 4
  ['tirajInlocuitInCurs', 'etichetele fără reverificarea finală (forma fdaa0496)', { fisier: 'redariFanTransport.mjs',
    din: "const t2 = await deps.rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: ct, p_inlocuieste: null })", in: "const t2 = { data: { ...t.data, stare: 'acelasi' } }" }],
  ['tirajInlocuitInCurs', 'refuzul „oprit” tratat ca neconfirmat (fără mesajul lui)', { fisier: 'redariFan.mjs', din: ": error?.code === COD_TIRAJ_OPRIT ? 'tiraj_oprit' : null)", in: ': null)' }],
  ['arhivaReverificata', 'arhiva fără reverificarea finală', { fisier: 'fanLot.js', din: "const { data, error } = await rpc('fn_red_fan_tiraj', { p_lot_id: lot.id, p_cheie: tiraj.cheie, p_inlocuieste: null })",
    in: "const { data, error } = { data: { stare: 'acelasi', cheie: tiraj.cheie, nr: tiraj.nr, inceput_la: tiraj.inceput_la } }" }],
  ['arhivaReverificata', 'reverificarea acceptă același cheie cu alt nr.', { fisier: 'redariFan.mjs', din: "return t && t.stare === 'acelasi' && t.nr === tiraj.nr ? t : null", in: "return t && t.stare === 'acelasi' ? t : null" }],
  ['confirmareNecunoscuta', 'elementul fără AWB ignorat', { fisier: 'redariFan.mjs', din: 'if (!lista || lista.some(el => !awbDin(el)))', in: 'if (!lista)' }],
  ['lotTest', 'prefixul TEST_ pierdut', { fisier: 'fanLot.js', din: "fanLot?.test === true ? 'TEST_' : ''", in: "''" }],
  ['lotTest', 'borderoul fără marcaj', { fisier: 'fanLot.js', din: "const cap = fanLot?.test === true ? [['LOT DE TEST", in: "const cap = false ? [['LOT DE TEST" }],
  ['poartaRol', 'fără verificarea owner-ului', { fisier: 'redariFanHandler.mjs', din: "if (owner?.data !== true) return out(403, 'non_owner')", in: '' }],
  // activare Testul 1: garda „doar TEST”
  ['doarTest', 'garda „doar TEST” scoasă', { fisier: 'redariFanHandler.mjs', din: '    if (!p.ok) return out(423, p.cod, { motiv: p.motiv })', in: '' }],
  ['doarTest', 'garda oprită din constantă (forma Testului 2)', { fisier: 'redariFanHandler.mjs', din: 'export const DOAR_PROIECTE_TEST = true', in: 'export const DOAR_PROIECTE_TEST = false' }],
  ['doarTest', 'orice proiect trece drept de TEST', { fisier: 'redariFanHandler.mjs', din: "export const esteProiectTest = cod => typeof cod === 'string' && cod.startsWith(PREFIX_PROIECT_TEST)", in: 'export const esteProiectTest = cod => true' }],
  ['doarTest', 'marcajul lotului neverificat', { fisier: 'redariFanHandler.mjs', din: "    if (cereMarcaj && fanLot?.test !== true) return", in: '    if (false) return' }],
  ['doarTest', 'flag-ul oprit (lotul de TEST n-ar mai trece)', { fisier: 'redariFanHandler.mjs', din: 'export const TRANSPORT_REAL_ACTIV = true', in: 'export const TRANSPORT_REAL_ACTIV = false' }],
  ['doarTest', 'ecranul ignoră garda (pașii activi pe proiect real)', { fisier: 'fanLot.js', din: '    if (oprit) return { ...p, motiv: oprit, activ: false }', in: '    if (false) return null' }],
  // activare runda 2: ordinea din cod schimbată → procedura documentului nu mai e executabilă
  ['procedura', 'marcajul cere lotul deja marcat (nu s-ar putea începe)', { fisier: 'fanLot.js', din: 'const oprit = motivTransport({ transportActiv, proiectCod, fanLot, cereMarcaj: false })', in: 'const oprit = motivTransport({ transportActiv, proiectCod, fanLot, cereMarcaj: true })' }],
  ['procedura', 'plafonul doar după un AWB generat', { fisier: 'fanLot.js', din: "    plafon: [[esteOwner, 'doar owner-ul']],", in: "    plafon: [[esteOwner, 'doar owner-ul'], [numar(randuri, ['generat']) > 0, 'niciun AWB generat']]," }],
  ['procedura', 'aprobarea cere rânduri deja aprobate', { fisier: 'fanLot.js', din: "[numar(randuri, ['propus']) > 0, 'niciun plic propus']", in: "[numar(randuri, ['aprobat']) > 0, 'niciun plic propus']" }],
  ['procedura', 'propunerea doar după prima aprobare', { fisier: 'fanLot.js', din: "    propune: [[poateScrie, 'doar admin / editor'], ", in: "    propune: [[poateScrie, 'doar admin / editor'], [!!fanLot?.prima_aprobare_la, 'lotul nu e aprobat'], " }],
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
  // runda 3: verificările noi pe head-ul revizuit în runda 2 (0716f5b3) TREBUIE să pice
  const NOI_R3 = ['tirajComun', 'controlIdentic', 'urmarireFaraEvenimente']
  it.skipIf(!surseR2).each(NOI_R3)('pe 0716f5b3 verificarea nouă „%s” PICĂ (constatarea era reală)', async v => {
    const M = await incarca(null, surseR2)
    let rez
    try { rez = await VERIFICARI[v](M) } catch { rez = false }
    expect(rez).toBe(false)
  })
  // runda 4: verificările noi pe head-ul revizuit în runda 3 (fdaa0496) TREBUIE să pice (P2 = proba PGlite a migrării)
  const NOI_R4 = ['tirajInlocuitInCurs', 'arhivaReverificata']
  it.skipIf(!surseR3).each(NOI_R4)('pe fdaa0496 verificarea nouă „%s” PICĂ (constatarea era reală)', async v => {
    const M = await incarca(null, surseR3)
    let rez
    try { rez = await VERIFICARI[v](M) } catch { rez = false }
    expect(rez).toBe(false)
  })
  // activare runda 2: procedura din documentul de la 9ceea228 (ordinea recenzentului: „Propune” înaintea marcajului) PICĂ pe codul real, cu motivul gărzii
  // (documentele vechi n-au coloana „Acțiune”: modul legacy recunoaște butoanele și verificările din text)
  it.skipIf(!PASI_VECHI)('documentul FAN_TEST1_PASI.md de la 9ceea228 NU e executabil din ecran (constatarea era reală)', async () => {
    const M = await incarca(null)
    const fn = { stariPasi: M.lot.stariPasi, stareMarcaj: M.lot.stareMarcaj, stariOperatii: M.lot.stariOperatii }
    expect(() => parcurge(pasiDinDocument(PASI_VECHI, '## 5.', '## 9.', { legacy: true }), fn)).toThrow(/pasul 1 \(propune\): „„1\. Propune 1 plicuri”” nu e activ în ecran \(transport doar pe loturi marcate TEST/)
    expect(await VERIFICARI.procedura(M)).toBe(true)
  })
  // activare runda 3: documentul de la 9fb88b2f — primul plic trece, dar continuarea „aceiași pași de la §5 la §8” pe lotul de 3 PICĂ: verificarea
  // GLOBALĂ din §6 (zero aprobări / trimiteri, exact un lot marcat) nu mai poate trece după primul AWB, nici cu plafonul 3 (istoricul rămâne)
  it.skipIf(!PASI_R2)('documentul FAN_TEST1_PASI.md de la 9fb88b2f: primul plic trece, continuarea cu trei plicuri PICĂ pe istoricul primului lot (constatarea era reală)', async () => {
    const M = await incarca(null)
    const fn = { stariPasi: M.lot.stariPasi, stareMarcaj: M.lot.stareMarcaj, stariOperatii: M.lot.stariOperatii }
    const pasi = pasiDinDocument(PASI_R2, '## 5.', '## 9.', { legacy: true })
    expect(pasi.map(p => p.actiune?.text || null)).toEqual(['marcaj-test', 'evenimente', 'plafon=1', 'verifica-plafon', 'verifica-fara-aprobari', 'propune', 'aproba', 'genereaza',
      'verifica-selfawb', 'verifica-tarif', 'etichete', 'verifica-eticheta', 'verifica-control', 'tipareste', 'etichete'])
    const lume = lumeNoua()
    expect(parcurge(pasi, fn, { lume, lot: 'PP-xxxx' }).lot.randuri[0].stare).toBe('generat')
    expect(() => parcurge(pasi, fn, { lume, lot: 'PP-yyyy', plicuri: 3 })).toThrow(/pasul 3 \(verifica-fara-aprobari\): verificarea globală „fără aprobări \/ trimiteri” nu poate trece: PP-xxxx: generat/)
    // nici cu plafonul 3, cum spunea paragraful final din §8: istoricul tot rămâne
    const cu3 = pasi.map(p => p.actiune?.cod === 'plafon' ? { ...p, actiune: { ...p.actiune, valoare: 3, text: 'plafon=3' } } : p)
    const lume2 = lumeNoua(); parcurge(pasi, fn, { lume: lume2, lot: 'PP-xxxx' })
    expect(() => parcurge(cu3, fn, { lume: lume2, lot: 'PP-yyyy', plicuri: 3 })).toThrow(/verificarea globală „fără aprobări \/ trimiteri” nu poate trece/)
  })
})
