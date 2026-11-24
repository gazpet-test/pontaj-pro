// TKT-2026-0347 — retur la furnizor, PR2 interfața: funcțiile pure. Valorile așteptate vin din spec v10 (§3.0, §3.3, §3.4) și din
// textul RPC-urilor 20270110a, calculate de mână — nu din codul testat. Date sintetice (MAT_A, CMD_T_001).
import { describe, it, expect, vi } from 'vitest'
import {
  laMii, dinMii, dovadaReceptie, primitaEfectivaMii, diferentaReceptie, deInlocuit, rezumatLinie, poateRedeschideReceptia, receptieRedeschisa,
  limiteDinStoc, mesajEroareCF, clasificaRezultat, cheieFereastra, registruPlanuri, executaPlan, ruleazaPlan, planReceptie, planPredare,
  planTransportDirect, planRetur, planAnulareRetur, planInchidereRetur, planReconciliere, locatieImplicita, MISCARE_META_RETUR, MESAJ_NECUNOSCUT,
  instantaneuReceptie, valoriInitialeReceptie, instantaneuDepasit, rezultatSalvareReceptie, poateDeschideRetur, ID_PLAN,
} from './achizitiiRetur.js'

const cmd = (extra = {}) => ({ id: 7, numar_comanda: 'CMD_T_001', status: 'emisa', proiect_id: 3, livrare_tip: 'santier',
  receptie_mp_la: null, receptie_achizitii_la: null, linii: [], ...extra })
const lin = (extra = {}) => ({ id: 11, denumire: 'MAT_A', um: 'buc', cantitate: 100, cantitate_primita: null, cantitate_intrata_stoc: 0,
  intrare_reconciliata: true, display_order: 0, ...extra })
const retur = (extra = {}) => ({ id: 1, tip: 'retur', linie_id: 11, denumire: 'MAT_A', cantitate: 40, din_stoc: 40, asteapta_inlocuire: true,
  cantitate_inlocuita: 0, cantitate_renuntata: 0, inchis_fel: null, ...extra })
const genSecv = () => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` }
const memorie = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }

describe('laMii / dinMii: cantități exacte, cel mult 3 zecimale', () => {
  it.each([
    ['12.5', 12500], ['2.25', 2250], ['0', 0], ['-10', -10000], ['1.2500', 1250], [12.5, 12500], [0.1, 100], [1.005, 1005],
  ])('%p → %p', (v, mii) => expect(laMii(v)).toBe(mii))
  it.each([['1.2345'], ['12,5'], ['abc'], [''], [null], [undefined], [NaN], [Infinity], ['1e3'], [12.5000001]])('%p → null (invalid)', v => {
    expect(laMii(v)).toBeNull()
  })
  it('12,5 − 10,25 dă exact 2,25 (nu 2,2500000000000004)', () => {
    expect(dinMii(laMii('12.5') - laMii('10.25'))).toBe(2.25)
    expect(dinMii(laMii(0.3) - laMii(0.1))).toBe(0.2)
  })
})

describe('dovadaReceptie — paritate cu fn_cf_dovada_receptie_intern (tabel de cazuri)', () => {
  // [descriere, linie, comanda, areJurnal, așteptat] — așteptat derivat din corpul SQL: primita NOT NULL OR intrata > 0 OR receptie_*_la OR
  // status IN (receptionata, in_stoc) OR jurnal; coalesce(..., true) = necunoscutul contează ca dovadă
  const cazuri = [
    ['nimic, emisă', lin(), cmd(), false, false],
    ['primita completată (chiar 0)', lin({ cantitate_primita: 0 }), cmd(), false, true],
    ['intrat în stoc > 0', lin({ cantitate_intrata_stoc: 5 }), cmd(), false, true],
    ['recepție MP semnată', lin(), cmd({ receptie_mp_la: '2026-11-20T10:00:00Z' }), false, true],
    ['recepție achiziții semnată', lin(), cmd({ receptie_achizitii_la: '2026-11-20T10:00:00Z' }), false, true],
    ['status receptionata', lin(), cmd({ status: 'receptionata' }), false, true],
    ['status in_stoc', lin(), cmd({ status: 'in_stoc' }), false, true],
    ['status ajunsa fără semnături', lin(), cmd({ status: 'ajunsa' }), false, false],
    ['jurnal existent', lin(), cmd(), true, true],
    ['intrata necunoscută → dovadă', lin({ cantitate_intrata_stoc: null }), cmd(), false, true],
    ['status necunoscut → dovadă', lin(), cmd({ status: null }), false, true],
  ]
  it.each(cazuri)('%s', (_d, l, c, j, astept) => expect(dovadaReceptie(l, c, { areJurnal: j })).toBe(astept))
  it('primita efectivă: NULL cu dovadă = comandată; NULL fără dovadă = 0', () => {
    expect(primitaEfectivaMii(lin(), cmd({ status: 'receptionata' }))).toBe(100000)
    expect(primitaEfectivaMii(lin(), cmd())).toBe(0)
    expect(primitaEfectivaMii(lin({ cantitate_primita: 40 }), cmd())).toBe(40000)
  })
})

describe('diferentaReceptie (Task 6)', () => {
  it('pozitiv: 40 citit → 100 trimite +60 cu primita citită 40', () => {
    expect(diferentaReceptie(lin({ cantitate_primita: 40 }), '100', cmd())).toEqual({ schimbare: true, delta: 60, primitaCitita: 40 })
  })
  it('negativ (corectură): 40 → 30 trimite −10', () => {
    expect(diferentaReceptie(lin({ cantitate_primita: 40 }), '30', cmd())).toEqual({ schimbare: true, delta: -10, primitaCitita: 40 })
  })
  it('NULL inițial fără recepție: 0 → 40, primita citită NULL', () => {
    expect(diferentaReceptie(lin(), '40', cmd())).toEqual({ schimbare: true, delta: 40, primitaCitita: null })
  })
  it('NULL cu dovadă (recepționată fără repere) = comandată: 100 → 120 trimite +20, primita citită NULL', () => {
    expect(diferentaReceptie(lin(), '120', cmd({ status: 'receptionata' }))).toEqual({ schimbare: true, delta: 20, primitaCitita: null })
  })
  it('zecimale: 12,5 → 10,25 trimite exact −2,25', () => {
    expect(diferentaReceptie(lin({ cantitate: 12.5, cantitate_primita: 12.5, um: 'm' }), '10.25', cmd()).delta).toBe(-2.25)
  })
  it('gol sau aceeași valoare = nicio schimbare', () => {
    expect(diferentaReceptie(lin({ cantitate_primita: 40 }), '', cmd())).toEqual({ schimbare: false })
    expect(diferentaReceptie(lin({ cantitate_primita: 40 }), '40.000', cmd())).toEqual({ schimbare: false })
  })
  it('sub intrat în stoc = eroare (pentru marfa intrată se folosește returul)', () => {
    expect(diferentaReceptie(lin({ cantitate_primita: 40, cantitate_intrata_stoc: 35 }), '30', cmd()).eroare).toMatch(/sub 35/)
  })
  it('scădere pe linie nereconciliată = eroare; creșterea merge', () => {
    const l = lin({ cantitate_primita: 40, intrare_reconciliata: false })
    expect(diferentaReceptie(l, '30', cmd()).eroare).toMatch(/nereconciliat/)
    expect(diferentaReceptie(l, '50', cmd()).delta).toBe(10)
  })
  it('valori invalide = eroare', () => {
    expect(diferentaReceptie(lin(), '-1', cmd()).eroare).toBeTruthy()
    expect(diferentaReceptie(lin(), '1.2345', cmd()).eroare).toBeTruthy()
  })
})

// Jakarinos r1 P1 #1: „0” scris explicit pe un reper fără nicio recepție nu se pierde ca „nicio schimbare”. RPC-ul refuză cantitatea 0
// (CF_CANTITATE_INVALIDA, 20270110a §6.1), deci comportamentul ales e refuzul explicit, înaintea oricărui apel.
describe('„0” explicit pe reper nerecepționat (r2 P1 #1)', () => {
  it('NULL fără dovadă + „0” = refuz cu calea corectă (Modifică repere), nu „nicio schimbare”', () => {
    for (const z of ['0', '0.000', ' 0 ']) {
      const d = diferentaReceptie(lin(), z, cmd())
      expect(d.schimbare).toBeUndefined()
      expect(d.eroare).toMatch(/MAT_A.*nu are nicio recepție/)
      expect(d.eroare).toContain('Modifică repere')
    }
  })
  it('gol pe același reper rămâne „nicio schimbare” (diferența gol ≠ zero se păstrează)', () => {
    expect(diferentaReceptie(lin(), '', cmd())).toEqual({ schimbare: false })
    expect(diferentaReceptie(lin(), null, cmd())).toEqual({ schimbare: false })
  })
  it('NULL CU dovadă (comanda recepționată) + „0” = corectură −comandat, ca în RPC (NULL se materializează la comandat, apoi −100)', () => {
    expect(diferentaReceptie(lin(), '0', cmd({ status: 'receptionata' }))).toEqual({ schimbare: true, delta: -100, primitaCitita: null })
    expect(diferentaReceptie(lin(), '0', cmd({ status: 'ajunsa', receptie_mp_la: '2026-11-20T10:00:00Z' })).delta).toBe(-100)
  })
  it('primit deja 0 + „0” = nicio schimbare; primit 40 + „0” = −40', () => {
    expect(diferentaReceptie(lin({ cantitate_primita: 0 }), '0', cmd())).toEqual({ schimbare: false })
    expect(diferentaReceptie(lin({ cantitate_primita: 40 }), '0', cmd())).toEqual({ schimbare: true, delta: -40, primitaCitita: 40 })
  })
  it('planul de recepție se oprește (nimic trimis), iar refuzul e de VALIDARE (formularul rămâne deschis cu valorile omului)', async () => {
    const c = cmd({ linii: [lin({ id: 11 }), lin({ id: 12, denumire: 'MAT_B', cantitate_primita: 10 })] })
    expect(planReceptie(c, { 11: '0', 12: '20' }).eroare).toMatch(/MAT_A/)
    const rpcFn = vi.fn()
    const rez = await executaPlan({ registru: registruPlanuri(memorie()), rpcFn, id: ID_PLAN.receptie(7), construieste: () => planReceptie(c, { 11: '0', 12: '20' }) })
    expect(rpcFn).not.toHaveBeenCalled()
    expect(rez).toMatchObject({ stare: 'refuz', faza: 'validare' })
    expect(rezultatSalvareReceptie(rez, 'CMD_T_001')).toMatchObject({ inchide: false, reincarca: false, tip: 'error' })
  })
})

// Jakarinos r1 P1 #2: după un conflict CAS formularul nu mai poate trimite diferențe calculate din valorile vechi peste noua bază.
describe('formularul de recepție: instantaneu + închidere după refuz (r2 P1 #2)', () => {
  const deschisLa100 = cmd({ status: 'in_stoc', linii: [lin({ id: 11, cantitate_primita: 100, cantitate_intrata_stoc: 0 })] })
  const dupaRetur80 = cmd({ status: 'in_stoc', linii: [lin({ id: 11, cantitate_primita: 80, cantitate_intrata_stoc: 0 })] })
  it('scenariul din review: intenția +10 pleacă cu CAS 100 din instantaneu, nu +30 cu CAS 80 din comanda reîncărcată', () => {
    const baza = instantaneuReceptie(deschisLa100)
    expect(valoriInitialeReceptie(baza)).toEqual({ 11: '100' })
    const p = planReceptie(baza, { 11: '110' }, genSecv())
    expect(p.pasi.map(x => [x.args.p_cantitate, x.args.p_primita_citita])).toEqual([[10, 100]])
    // contra-probă: calculul pe comanda proaspătă ar fi dat exact defectul raportat
    expect(planReceptie(dupaRetur80, { 11: '110' }, genSecv()).pasi.map(x => [x.args.p_cantitate, x.args.p_primita_citita])).toEqual([[30, 80]])
  })
  it('instantaneul nu se schimbă când comanda din pagină se reîncarcă (copie a liniilor)', () => {
    const c = cmd({ linii: [lin({ id: 11, cantitate_primita: 100 })] })
    const baza = instantaneuReceptie(c)
    c.linii[0].cantitate_primita = 80
    expect(baza.linii[0].cantitate_primita).toBe(100)
  })
  it('instantaneuDepasit: vede primit / intrat / reconciliere / linii / status / semnături schimbate; nu vede câmpuri fără efect', () => {
    const baza = instantaneuReceptie(deschisLa100)
    expect(instantaneuDepasit(baza, instantaneuReceptie(deschisLa100))).toBe(false)
    expect(instantaneuDepasit(baza, dupaRetur80)).toBe(true)
    const cu = (l, c = {}) => cmd({ status: 'in_stoc', ...c, linii: [lin({ id: 11, cantitate_primita: 100, cantitate_intrata_stoc: 0, ...l })] })
    expect(instantaneuDepasit(baza, cu({ cantitate_intrata_stoc: 5 }))).toBe(true)
    expect(instantaneuDepasit(baza, cu({ intrare_reconciliata: false }))).toBe(true)
    expect(instantaneuDepasit(baza, cu({ cantitate: 90 }))).toBe(true)
    expect(instantaneuDepasit(baza, cu({}, { status: 'receptionata' }))).toBe(true)
    expect(instantaneuDepasit(baza, cu({}, { receptie_mp_la: '2026-11-20T10:00:00Z' }))).toBe(true)
    expect(instantaneuDepasit(baza, { ...cu({}), linii: [...cu({}).linii, lin({ id: 12 })] })).toBe(true)
    expect(instantaneuDepasit(baza, cu({ observatii: 'altceva', termen_livrare: '2026-12-01' }))).toBe(false)
  })
  it('conflict CAS la salvare (CF_VALOARE_SCHIMBATA / CF_CLIENT_VECHI) → formularul se ÎNCHIDE și se reîncarcă; planul iese din registru', async () => {
    for (const cod of ['CF_VALOARE_SCHIMBATA', 'CF_CLIENT_VECHI']) {
      const registru = registruPlanuri(memorie())
      const rpcFn = vi.fn().mockResolvedValue({ data: null, error: { code: 'P0001', message: `${cod}: s-a schimbat` }, status: 400 })
      const baza = instantaneuReceptie(deschisLa100)
      const rez = await executaPlan({ registru, rpcFn, id: ID_PLAN.receptie(7), construieste: () => planReceptie(baza, { 11: '110' }) })
      expect(rpcFn.mock.calls[0][1]).toMatchObject({ p_cantitate: 10, p_primita_citita: 100 })
      const u = rezultatSalvareReceptie(rez, 'CMD_T_001')
      expect(u).toMatchObject({ inchide: true, reincarca: true, tip: 'error' })
      expect(u.mesaj).toMatch(/Datele s-au schimbat/)
      expect(u.mesaj).toMatch(/Formularul s-a închis/)
      expect(registru.citeste(ID_PLAN.receptie(7))).toBeNull()
    }
  })
  it('alte rezultate: necunoscut = rămâne deschis (se retrimite planul salvat); ok / gol = se închide; plan corupt = se închide', async () => {
    expect(rezultatSalvareReceptie({ stare: 'necunoscut', mesaj: MESAJ_NECUNOSCUT }, 'X')).toMatchObject({ inchide: false, reincarca: false, tip: 'warn' })
    expect(rezultatSalvareReceptie({ stare: 'ok', reluat: true }, 'CMD_T_001')).toMatchObject({ inchide: true, reincarca: true, tip: 'success' })
    expect(rezultatSalvareReceptie({ stare: 'gol' }, 'X')).toMatchObject({ inchide: true, reincarca: false })
    const st = memorie(); st.setItem('gazpet.achizitii.cf_plan.receptie:7', '{rupt')
    const rez = await executaPlan({ registru: registruPlanuri(st), rpcFn: vi.fn(), id: ID_PLAN.receptie(7), construieste: () => null })
    expect(rezultatSalvareReceptie(rez, 'X')).toMatchObject({ inchide: true, reincarca: true })
  })
})

// Jakarinos r1 P2 #3: cererea neconfirmată rămâne accesibilă indiferent de eligibilitatea unei operații noi.
describe('reluarea unui retur neconfirmat după refresh (r2 P2 #3)', () => {
  const dupaReturIntegral = lin({ id: 11, cantitate_primita: 0, cantitate_intrata_stoc: 0 })
  const c = cmd({ status: 'in_stoc' })
  it('primit efectiv 0 după returul integral comis: fără plan butonul lipsește, cu plan în registru apare', () => {
    expect(poateDeschideRetur({ poateScrie: true, comanda: c, linie: dupaReturIntegral, retururiOk: true, areCerere: false })).toBe(false)
    expect(poateDeschideRetur({ poateScrie: true, comanda: c, linie: dupaReturIntegral, retururiOk: true, areCerere: true })).toBe(true)
  })
  it('cererea în așteptare trece și peste retururile necitite / linia de reconciliat / statusul schimbat (decide serverul la retrimitere)', () => {
    expect(poateDeschideRetur({ poateScrie: true, comanda: cmd({ status: 'anulata' }), linie: lin({ intrare_reconciliata: false }), retururiOk: false, areCerere: true })).toBe(true)
  })
  it('fără drept de scriere: niciodată', () => {
    expect(poateDeschideRetur({ poateScrie: false, comanda: c, linie: dupaReturIntegral, retururiOk: true, areCerere: true })).toBe(false)
  })
  it('eligibilitatea obișnuită rămâne neschimbată', () => {
    const ok = { poateScrie: true, comanda: c, linie: lin({ cantitate_primita: 40 }), retururiOk: true, areCerere: false }
    expect(poateDeschideRetur(ok)).toBe(true)
    expect(poateDeschideRetur({ ...ok, retururiOk: false })).toBe(false)
    expect(poateDeschideRetur({ ...ok, comanda: cmd({ status: 'in_stoc', este_servicii: true }) })).toBe(false)
    expect(poateDeschideRetur({ ...ok, comanda: cmd({ status: 'ciorna' }) })).toBe(false)
    expect(poateDeschideRetur({ ...ok, linie: lin({ cantitate_primita: 40, intrare_reconciliata: false }) })).toBe(false)
  })
  it('după refresh, planul salvat se retrimite IDENTIC (aceeași cheie, aceiași parametri) și iese din registru la rezultatul comis', async () => {
    const st = memorie()
    const plan = { v: 1, creat_la: '2026-11-24T20:00:00Z', pasi: [{ rpc: 'fn_cf_retur_inregistreaza', eticheta: 'MAT_A',
      args: { p_cheie: '00000000-0000-4000-8000-000000000009', p_linie_id: 11, p_cantitate: 100, p_din_stoc: 0 } }] }
    st.setItem('gazpet.achizitii.cf_plan.' + ID_PLAN.retur(11), JSON.stringify(plan))
    const registru = registruPlanuri(st)  // registru nou = pagină reîncărcată
    const rpcFn = vi.fn().mockResolvedValue({ data: { retur_id: 5, reluat: true }, error: null, status: 200 })
    const construieste = vi.fn(() => ({ eroare: 'nu trebuie construit nimic nou' }))
    const rez = await executaPlan({ registru, rpcFn, id: ID_PLAN.retur(11), construieste })
    expect(construieste).not.toHaveBeenCalled()
    expect(rpcFn).toHaveBeenCalledWith('fn_cf_retur_inregistreaza', plan.pasi[0].args)
    expect(rez).toMatchObject({ stare: 'ok', reluat: true })
    expect(registru.citeste(ID_PLAN.retur(11))).toBeNull()
  })
  it('cheile registrului sunt cele folosite până acum (compatibilitate cu planurile deja salvate)', () => {
    expect([ID_PLAN.receptie(7), ID_PLAN.retur(11), ID_PLAN.reconciliere(11), ID_PLAN.anulare(5), ID_PLAN.inchidere(5),
      ID_PLAN.predare(7, true), ID_PLAN.predare(7, false), ID_PLAN.transport(7)])
      .toEqual(['receptie:7', 'retur:11', 'reconciliere:11', 'anulare:5', 'inchidere:5', 'predare_partiala:7', 'predare_pv2:7', 'transport:7'])
  })
})

describe('deInlocuit / rezumatLinie / redeschiderea recepției (Task 6–7)', () => {
  it('deInlocuit: deschis parțial, acoperit, renunțat, anulat, fără așteptare', () => {
    expect(deInlocuit(retur({ cantitate_inlocuita: 10 }))).toBe(30)
    expect(deInlocuit(retur({ cantitate_inlocuita: 40, asteapta_inlocuire: false, inchis_fel: 'acoperit' }))).toBe(0)
    expect(deInlocuit(retur({ cantitate_inlocuita: 10, cantitate_renuntata: 30, asteapta_inlocuire: false, inchis_fel: 'renuntat' }))).toBe(0)
    expect(deInlocuit(retur({ asteapta_inlocuire: false, inchis_fel: 'anulat' }))).toBe(0)
    expect(deInlocuit(retur({ asteapta_inlocuire: false }))).toBe(0)
    // proba 12: renunțare la 30, apoi corectura redeschide 10 → de înlocuit 10, nu 40
    expect(deInlocuit(retur({ cantitate_inlocuita: 0, cantitate_renuntata: 30, asteapta_inlocuire: true, inchis_fel: null }))).toBe(10)
  })
  it('rezumat: returnat net fără retururile anulate, de înlocuit pe linie', () => {
    const rr = [retur({ id: 1, cantitate: 20 }), retur({ id: 2, cantitate: 15, asteapta_inlocuire: false, inchis_fel: 'anulat' }),
      { id: 3, tip: 'anulare', retur_id: 2, linie_id: 11, cantitate: 15 }, retur({ id: 4, linie_id: 12, cantitate: 5 })]
    const r = rezumatLinie(11, rr)
    expect(r.returnatMii).toBe(20000)
    expect(r.deInlocuitMii).toBe(20000)
    expect(r.deschise.map(x => x.id)).toEqual([1])
  })
  it('poateRedeschideReceptia: de înlocuit > 0 sau primit neintrat; altfel nu', () => {
    const c = cmd({ status: 'in_stoc' })
    expect(poateRedeschideReceptia(lin({ cantitate_primita: 60, cantitate_intrata_stoc: 60 }), [retur()], c)).toBe(true)
    expect(poateRedeschideReceptia(lin({ cantitate_primita: 60, cantitate_intrata_stoc: 40 }), [], c)).toBe(true)
    expect(poateRedeschideReceptia(lin({ cantitate_primita: 60, cantitate_intrata_stoc: 60 }), [], c)).toBe(false)
    expect(poateRedeschideReceptia(lin({ cantitate_primita: 60, cantitate_intrata_stoc: 60 }),
      [retur({ asteapta_inlocuire: false, inchis_fel: 'renuntat', cantitate_renuntata: 40 })], c)).toBe(false)
  })
  it('receptieRedeschisa doar în receptionata / in_stoc', () => {
    const l = lin({ cantitate_primita: 60, cantitate_intrata_stoc: 40 })
    expect(receptieRedeschisa(cmd({ status: 'in_stoc', linii: [l] }), [])).toBe(true)
    expect(receptieRedeschisa(cmd({ status: 'emisa', linii: [l] }), [])).toBe(false)
    expect(receptieRedeschisa(cmd({ status: 'in_stoc', linii: [lin({ cantitate_primita: 60, cantitate_intrata_stoc: 60 })] }), [])).toBe(false)
  })
})

describe('limiteDinStoc (spec §3.0)', () => {
  it('100 primite, 40 intrate, retur 20: din stoc 0…20, implicit 20', () => {
    expect(limiteDinStoc(lin({ cantitate_primita: 100, cantitate_intrata_stoc: 40 }), '20', cmd()))
      .toMatchObject({ minMii: 0, maxMii: 20000, implicitMii: 20000, maxReturMii: 100000 })
  })
  it('după primul retur (80 primite, 20 intrate), al doilea retur de 20: 0…20', () => {
    expect(limiteDinStoc(lin({ cantitate_primita: 80, cantitate_intrata_stoc: 20 }), 20, cmd())).toMatchObject({ minMii: 0, maxMii: 20000 })
  })
  it('retur 70 din 100 primite / 40 intrate: din stoc 10…40 (60 neintrate acoperă doar 60)', () => {
    expect(limiteDinStoc(lin({ cantitate_primita: 100, cantitate_intrata_stoc: 40 }), '70', cmd())).toMatchObject({ minMii: 10000, maxMii: 40000 })
  })
  it('20 primite, nimic intrat: din stoc 0…0 (fără mișcare)', () => {
    expect(limiteDinStoc(lin({ cantitate_primita: 20 }), '10', cmd())).toMatchObject({ minMii: 0, maxMii: 0, implicitMii: 0 })
  })
  it('zecimale: 12,5 m primite și intrate, retur 2,25 → din stoc exact 2,25', () => {
    expect(limiteDinStoc(lin({ cantitate: 12.5, cantitate_primita: 12.5, cantitate_intrata_stoc: 12.5 }), '2.25', cmd()))
      .toMatchObject({ minMii: 2250, maxMii: 2250 })
  })
  it('peste primit sau ≤ 0 = eroare', () => {
    expect(limiteDinStoc(lin({ cantitate_primita: 60 }), '61', cmd()).eroare).toMatch(/cel mult 60/)
    expect(limiteDinStoc(lin({ cantitate_primita: 60 }), '0', cmd()).eroare).toBeTruthy()
  })
})

describe('mesajEroareCF — ui_eroare_client_vechi', () => {
  it('CF_CLIENT_VECHI și CF_VALOARE_SCHIMBATA → mesajul exact „reîncărcați pagina”', () => {
    const exact = 'Datele s-au schimbat între timp — reîncărcați pagina.'
    expect(mesajEroareCF({ code: 'P0001', message: 'CF_CLIENT_VECHI: cantitatile primite / intrate se scriu doar prin receptie si predare; reincarcati pagina' })).toBe(exact)
    expect(mesajEroareCF({ code: 'P0001', message: 'CF_VALOARE_SCHIMBATA: cantitatea primita s-a schimbat intre timp (acum 40); reincarcati pagina' })).toBe(exact)
  })
  it('CF_NERECONCILIATA → mesajul din plan', () => {
    expect(mesajEroareCF({ code: 'P0001', message: 'CF_NERECONCILIATA: receptie veche nereconciliata: reconciliati intai' }))
      .toBe('Recepție veche nereconciliată — cereți reconcilierea.')
  })
  it('coduri cu cifre păstrează detaliul serverului; dreptul și FK-ul au mesaj propriu', () => {
    expect(mesajEroareCF({ code: 'P0001', message: 'CF_STOC_INSUFICIENT: in stoc sunt doar 5' })).toBe('Stoc insuficient: in stoc sunt doar 5')
    expect(mesajEroareCF({ code: '42501', message: 'CF_DREPT: operatie nepermisa' })).toBe('Nu aveți drept pentru această operație.')
    expect(mesajEroareCF({ code: '42501', message: 'permission denied for table comenzi_furnizor_linii' })).toBe('Nu aveți drept pentru această operație.')
    expect(mesajEroareCF({ code: 'P0001', message: 'CF_ISTORIC_PROTEJAT: pozitie cu istoric de achizitie / retur; corectati prin ajustare' })).toMatch(/nu se șterge/)
    expect(mesajEroareCF({ code: '23503', message: 'violates foreign key' })).toMatch(/nu se poate șterge/)
    expect(mesajEroareCF({ message: 'altceva' })).toBe('altceva')
  })
})

describe('clasificaRezultat (L05): doar 4xx e refuz cert', () => {
  it.each([
    [{ error: null, status: 200 }, 'ok'], [{ error: { code: 'P0001' }, status: 400 }, 'refuz'], [{ error: { code: '42501' }, status: 403 }, 'refuz'],
    [{ error: { message: 'Failed to fetch' }, status: 0 }, 'necunoscut'], [{ error: { code: '57014' }, status: 500 }, 'necunoscut'],
    [{ error: { message: 'x' } }, 'necunoscut'], [{ error: { message: 'gateway' }, status: 504 }, 'necunoscut'],
  ])('%j → %s', (r, astept) => expect(clasificaRezultat(r)).toBe(astept))
})

describe('ui_cheie_o_data: cheia ferestrei', () => {
  it('două trimiteri din aceeași fereastră folosesc aceeași cheie', () => {
    const gen = vi.fn(genSecv())
    const k = cheieFereastra(gen)
    const a = k.get(), b = k.get()
    expect(a).toBe(b)
    expect(gen).toHaveBeenCalledTimes(1)
    k.reinnoieste()
    expect(k.get()).not.toBe(a)
  })
  it('reîncercarea după rezultat necunoscut retrimite EXACT aceeași cerere (cheie + parametri), chiar dacă formularul s-a schimbat', async () => {
    const registru = registruPlanuri(memorie())
    const apeluri = []
    let raspuns = { error: { message: 'Failed to fetch' }, status: 0 }
    const rpcFn = async (rpc, args) => { apeluri.push({ rpc, args }); return raspuns }
    const formular = { cantitate: '20' }
    const construieste = () => planRetur({ linie: lin({ cantitate_primita: 100, cantitate_intrata_stoc: 40 }), comanda: cmd(), cantitate: formular.cantitate,
      dinStoc: '', locatie: 'proiect', motiv: 'neconform la livrare', pvPath: null, asteaptaInlocuire: true, cheie: 'k-1' })
    const r1 = await executaPlan({ registru, rpcFn, id: 'retur:11', construieste })
    expect(r1.stare).toBe('necunoscut')
    expect(r1.mesaj).toBe(MESAJ_NECUNOSCUT)
    formular.cantitate = '30'
    raspuns = { data: { retur_id: 5, reluat: true }, error: null, status: 200 }
    const r2 = await executaPlan({ registru, rpcFn, id: 'retur:11', construieste })
    expect(r2.stare).toBe('ok')
    expect(r2.reluat).toBe(true)
    expect(apeluri[1]).toEqual(apeluri[0])
    expect(apeluri[1].args.p_cantitate).toBe(20)
    expect(registru.citeste('retur:11')).toBeNull()
  })
})

describe('registru + executaPlan (L05)', () => {
  it('registrul nu se poate scrie → nu se trimite nimic', async () => {
    const st = { getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    const rpcFn = vi.fn()
    const r = await executaPlan({ registru: registruPlanuri(st), rpcFn, id: 'x', construieste: () => ({ pasi: [{ rpc: 'fn_cf_intra_stoc', args: {} }] }) })
    expect(r.stare).toBe('refuz')
    expect(rpcFn).not.toHaveBeenCalled()
  })
  it('refuz cert la pasul 2: planul iese din registru, mesajul spune că pasul 1 s-a înregistrat', async () => {
    const registru = registruPlanuri(memorie())
    const rpcFn = vi.fn()
      .mockResolvedValueOnce({ data: { ok: 1 }, error: null, status: 200 })
      .mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'CF_PESTE_PRIMIT: se pot preda in stoc cel mult 0' }, status: 400 })
    const r = await executaPlan({ registru, rpcFn, id: 'p', construieste: () => ({ pasi: [
      { rpc: 'fn_cf_intra_stoc', eticheta: 'MAT_A', args: { p_cheie: 'a' } }, { rpc: 'fn_cf_intra_stoc', eticheta: 'MAT_B', args: { p_cheie: 'b' } }] }) })
    expect(r.stare).toBe('refuz')
    expect(r.mesaj).toMatch(/^MAT_B: Cantitate peste primit/)
    expect(r.mesaj).toMatch(/pașii anteriori, 1/)
    expect(registru.citeste('p')).toBeNull()
  })
  it('planul corupt e scos și nu se trimite nimic', async () => {
    const st = memorie(); st.setItem('gazpet.achizitii.cf_plan.z', '{rupt')
    const rpcFn = vi.fn()
    const r = await executaPlan({ registru: registruPlanuri(st), rpcFn, id: 'z', construieste: () => ({ pasi: [{ rpc: 'a', args: {} }] }) })
    expect(r.stare).toBe('refuz')
    expect(rpcFn).not.toHaveBeenCalled()
    expect(st.m.size).toBe(0)
  })
  it('pastreazaLaOk: planul rămâne după ok, până îl scoate apelantul', async () => {
    const registru = registruPlanuri(memorie())
    const r = await executaPlan({ registru, rpcFn: async () => ({ data: {}, error: null, status: 200 }), id: 't', pastreazaLaOk: true,
      construieste: () => ({ pasi: [{ rpc: 'a', args: {} }] }) })
    expect(r.stare).toBe('ok')
    expect(registru.citeste('t')).not.toBeNull()
  })
  it('excepția aruncată de client = necunoscut, nu refuz', async () => {
    const r = await ruleazaPlan(async () => { throw new TypeError('Failed to fetch') }, { pasi: [{ rpc: 'a', args: {} }] })
    expect(r.stare).toBe('necunoscut')
  })
})

describe('planurile fluxurilor', () => {
  it('planReceptie: doar liniile schimbate, cu primita citită brută; o eroare oprește tot', () => {
    const c = cmd({ linii: [lin({ id: 11, cantitate_primita: 40 }), lin({ id: 12, denumire: 'MAT_B', cantitate_primita: null })] })
    const p = planReceptie(c, { 11: '100', 12: '' }, genSecv())
    expect(p.pasi).toHaveLength(1)
    expect(p.pasi[0].args).toEqual({ p_cheie: '00000000-0000-4000-8000-000000000001', p_linie_id: 11, p_cantitate: 60, p_primita_citita: 40 })
    expect(planReceptie(c, { 11: '40' })).toBeNull()
    expect(planReceptie(c, { 11: '100', 12: '-3' }).eroare).toMatch(/MAT_B/)
  })
  it('planPredare parțial: doar liniile cu recepție pe repere, doar restul neintrat', () => {
    const c = cmd({ linii: [lin({ id: 11, cantitate_primita: 60, cantitate_intrata_stoc: 20 }), lin({ id: 12, denumire: 'MAT_B' })] })
    const p = planPredare(c, { partial: true }, genSecv())
    expect(p.pasi.map(x => [x.args.p_linie_id, x.args.p_cantitate, x.args.p_transfer_proiect])).toEqual([[11, 40, false]])
  })
  it('planPredare PV 2 (recepționată): NULL = comandată; linia nereconciliată blochează tot planul', () => {
    const c = cmd({ status: 'receptionata', linii: [lin({ id: 11 }), lin({ id: 12, denumire: 'MAT_B', cantitate: 5 })] })
    expect(planPredare(c, {}, genSecv()).pasi.map(x => x.args.p_cantitate)).toEqual([100, 5])
    const c2 = cmd({ status: 'receptionata', linii: [lin({ id: 11 }), lin({ id: 12, denumire: 'MAT_B', intrare_reconciliata: false })] })
    const p2 = planPredare(c2, {}, genSecv())
    expect(p2.eroare).toMatch(/MAT_B \(de reconciliat\)/)
    expect(p2.pasi).toBeUndefined()
  })
  it('planTransportDirect: NULL fără dovadă = recepție integrală + intrare cu transfer; NULL cu dovadă = doar intrarea', () => {
    const c = cmd({ status: 'ajunsa', linii: [lin({ id: 11, cantitate: 30 }), lin({ id: 12, denumire: 'MAT_B', cantitate: 10, cantitate_primita: 8 })] })
    const p = planTransportDirect(c, genSecv())
    expect(p.pasi.map(x => [x.rpc, x.args.p_linie_id, x.args.p_cantitate])).toEqual([
      ['fn_cf_receptie_adauga', 11, 30], ['fn_cf_intra_stoc', 11, 30], ['fn_cf_intra_stoc', 12, 8]])
    expect(p.pasi[0].args.p_primita_citita).toBeNull()
    expect(p.pasi[1].args.p_transfer_proiect).toBe(true)
    const cs = cmd({ status: 'ajunsa', receptie_mp_la: '2026-11-20T10:00:00Z', linii: [lin({ id: 11, cantitate: 30 })] })
    expect(planTransportDirect(cs, genSecv()).pasi.map(x => x.rpc)).toEqual(['fn_cf_intra_stoc'])
    expect(planTransportDirect(cmd({ status: 'ajunsa', linii: [lin({ denumire: 'MAT_A ' })] })).eroare).toMatch(/spații/)
  })
  it('planRetur: limite, locație, motiv, stoc cunoscut; implicit = maximul din stoc', () => {
    const l = lin({ cantitate_primita: 100, cantitate_intrata_stoc: 40 })
    const baza = { linie: l, comanda: cmd(), cantitate: '20', dinStoc: '', locatie: 'proiect', motiv: 'neconform', pvPath: '7/x.pdf', asteaptaInlocuire: true, cheie: 'k' }
    expect(planRetur(baza).pasi[0].args).toEqual({ p_cheie: 'k', p_linie_id: 11, p_cantitate: 20, p_din_stoc: 20, p_locatie_tip: 'proiect',
      p_locatie_id: 3, p_motiv: 'neconform', p_pv_path: '7/x.pdf', p_asteapta_inlocuire: true })
    expect(planRetur({ ...baza, dinStoc: '25' }).eroare).toMatch(/între 0 și 20/)
    expect(planRetur({ ...baza, motiv: 'abc ' }).eroare).toMatch(/5 caractere/)
    expect(planRetur({ ...baza, locatie: 'altundeva' }).eroare).toMatch(/Locație invalidă/)
    expect(planRetur({ ...baza, stocLocatieMii: 5000 }).eroare).toMatch(/doar 5/)
    expect(planRetur({ ...baza, dinStoc: '0', stocLocatieMii: 0 }).pasi[0].args.p_din_stoc).toBe(0)
    expect(planRetur({ ...baza, linie: { ...l, intrare_reconciliata: false } }).eroare).toMatch(/reconciliere/)
    expect(planRetur({ ...baza, comanda: cmd({ proiect_id: null }) }).eroare).toMatch(/Locație invalidă/)
  })
  it('planAnulareRetur / planInchidereRetur / planReconciliere', () => {
    expect(planAnulareRetur({ retur: retur(), motiv: 'greșeală', cheie: 'k' }).pasi[0].args).toEqual({ p_cheie: 'k', p_retur_id: 1, p_motiv: 'greșeală' })
    expect(planAnulareRetur({ retur: retur({ cantitate_inlocuita: 1 }), motiv: 'greșeală', cheie: 'k' }).eroare).toMatch(/înlocuire/)
    expect(planInchidereRetur({ retur: retur(), motiv: 'furnizorul nu mai livrează', cheie: 'k' }).pasi[0].rpc).toBe('fn_cf_retur_inchide_fara_inlocuire')
    expect(planInchidereRetur({ retur: retur({ asteapta_inlocuire: false }), motiv: 'motiv lung', cheie: 'k' }).eroare).toBeTruthy()
    const l = lin({ cantitate_primita: 100, intrare_reconciliata: false })
    expect(planReconciliere({ linie: l, comanda: cmd(), intrataStoc: '70', motiv: 'verificat fizic', cheie: 'k' }).pasi[0].args.p_intrata_stoc).toBe(70)
    expect(planReconciliere({ linie: l, comanda: cmd(), intrataStoc: '101', motiv: 'verificat fizic', cheie: 'k' }).eroare).toMatch(/între 0 și 100/)
    expect(planReconciliere({ linie: lin(), comanda: cmd(), intrataStoc: '0', motiv: 'verificat fizic', cheie: 'k' }).eroare).toMatch(/deja/)
  })
  it('locația implicită urmează livrarea', () => {
    expect(locatieImplicita(cmd({ livrare_tip: 'sediu' }))).toBe('sediu')
    expect(locatieImplicita(cmd())).toBe('proiect')
    expect(locatieImplicita(cmd({ proiect_id: null }))).toBe('sediu')
  })
})

describe('Magazie: etichetele mișcărilor noi (Task 8)', () => {
  it('retur_furnizor și retur_furnizor_anulare au etichetă', () => {
    expect(MISCARE_META_RETUR.retur_furnizor.label).toBe('Retur la furnizor')
    expect(MISCARE_META_RETUR.retur_furnizor_anulare.label).toBe('Anulare retur')
  })
})
