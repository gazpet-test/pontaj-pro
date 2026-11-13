// r5 — cota Vaisala Xweather din antete (logica pură din supabase/functions/meteo-sync/xweather_cota_logica.ts) și rotația cozii pasului
// zilnic (xweather_zilnic_logica.ts). Valorile așteptate sunt scrise de mână din documentația oficială Xweather (L25): multiplicatorii
// conditions / forecasts / alerts = 1, airquality = 5, conditions/summary = 1 pe zi; schema vremii curente (19 ținte, 12 rulări / zi,
// 4 complete) = 760 de unități / zi cu aerul de 4 ori, 570 / 475 / 380 cu 2 / 1 / 0.
import { describe, it, expect } from 'vitest'
import {
  endpointDin, numarAntet, momentAntet, textAntet, produsMultiplicatori, costCerere, depasire, motivDepasire, contorNou, inregistreaza,
  totalPrudent, costEndpoint, costZiSantier, blocCota, aerPeZi, cereAer, zilnicActiv, costZiVremeCurenta, gardaCota, incapeInCota,
  MARJA_COTA, PLAFON_COTA_NECUNOSCUTA, MAX_UNITATI_XW_RULARE, NEAJUNSA_COTA,
} from '../supabase/functions/meteo-sync/xweather_cota_logica.ts'
import { rotesteCoada, indexZi, poateIncepeZi } from '../supabase/functions/meteo-sync/xweather_zilnic_logica.ts'

const ACUM = Date.parse('2026-11-13T04:05:00Z')
const H = (o) => ({ get: (k) => { const e = Object.entries(o).find(([n]) => n.toLowerCase() === k.toLowerCase()); return e ? e[1] : null } })

describe('endpoint-ul unei cereri (fără credențiale)', () => {
  it('cele 6 endpoint-uri folosite; altceva = necunoscut', () => {
    expect(endpointDin('conditions/44.1,26?fields=x')).toBe('conditions')
    expect(endpointDin('conditions/summary/44.1,26?from=1&to=2')).toBe('conditions/summary')
    expect(endpointDin('observations/summary/closest?p=44,26')).toBe('observations/summary')
    expect(endpointDin('forecasts/Ploiesti%2C%20ro?filter=day')).toBe('forecasts')
    expect(endpointDin('alerts/44,26?limit=5')).toBe('alerts')
    expect(endpointDin('airquality/44,26?fields=x')).toBe('airquality')
    expect(endpointDin('observations/44,26')).toBe('necunoscut')
    expect(endpointDin('batch?requests=x')).toBe('necunoscut')
  })
})

describe('antetele sunt conținut extern: doar valori validate', () => {
  it('numere', () => {
    expect(numarAntet('30')).toBe(30)
    expect(numarAntet(' 2.5 ')).toBe(2.5)
    for (const v of [null, undefined, '', '-1', '1e3', 'abc', '1234567890', '1,5']) expect(numarAntet(v)).toBeNull()
  })
  it('momentul resetării: dată GMT / ISO / secunde / milisecunde; în afara [acum − 1 zi, acum + 400 de zile] = null', () => {
    const t = Date.parse('2026-11-30T00:00:00Z')
    expect(momentAntet('Mon, 30 Nov 2026 00:00:00 GMT', ACUM)).toBe(t)
    expect(momentAntet('2026-11-30T00:00:00Z', ACUM)).toBe(t)
    expect(momentAntet(String(t / 1000), ACUM)).toBe(t)
    expect(momentAntet(String(t), ACUM)).toBe(t)
    expect(momentAntet('2020-01-01T00:00:00Z', ACUM)).toBeNull()
    expect(momentAntet('2030-01-01T00:00:00Z', ACUM)).toBeNull()
    expect(momentAntet('mâine', ACUM)).toBeNull()
    expect(momentAntet('<script>', ACUM)).toBeNull()
  })
  it('text scurt dintr-un alfabet restrâns (fără /, ?, &, caractere de control)', () => {
    expect(textAntet('endpoint=10; spatial=3; temporal=1')).toBe('endpoint=10; spatial=3; temporal=1')
    expect(textAntet('month')).toBe('month')
    for (const v of ['https://x', 'a?b', 'a&b', 'x'.repeat(81), 'a' + String.fromCharCode(10) + 'b', '']) expect(textAntet(v)).toBeNull()
  })
  it('produsul multiplicatorilor (exemplul oficial: endpoint=10; spatial=3; temporal=1 → 30)', () => {
    expect(produsMultiplicatori('endpoint=10; spatial=3; temporal=1')).toBe(30)
    expect(produsMultiplicatori('endpoint=5,temporal=1,spatial=1')).toBe(5)
    expect(produsMultiplicatori('endpoint=x')).toBeNull()
    expect(produsMultiplicatori(null)).toBeNull()
  })
})

describe('costul unei cereri', () => {
  it('2xx: X-Cost-Tokens; fără el: X-Cost-Multipliers sau X-Cost-Multiplier; fără niciunul: multiplicatorul documentat (estimat)', () => {
    expect(costCerere('conditions', 200, H({ 'X-Cost-Tokens': '1' }))).toEqual({ unitati: 1, sursa: 'antet', multiplicatori: null })
    expect(costCerere('forecasts', 200, H({ 'X-Cost-Multipliers': 'endpoint=1; temporal=4; spatial=1' }))).toMatchObject({ unitati: 4, sursa: 'multiplicatori' })
    expect(costCerere('forecasts', 200, H({ 'X-Cost-Multiplier': 'endpoint=10; spatial=3; temporal=1' }))).toMatchObject({ unitati: 30, sursa: 'multiplicatori' })
    expect(costCerere('airquality', 200, H({}))).toEqual({ unitati: 5, sursa: 'estimat', multiplicatori: null })
    expect(costCerere('conditions/summary', 200, null)).toMatchObject({ unitati: 1, sursa: 'estimat' })
    expect(costCerere('observations/summary', 204, H({}))).toMatchObject({ unitati: 1, sursa: 'estimat' })
  })
  it('4xx / 5xx / rețea: antetul de cost nu se folosește; prudent = multiplicatorul documentat, marcat estimat', () => {
    expect(costCerere('airquality', 503, H({ 'X-Cost-Tokens': '0' }))).toMatchObject({ unitati: 5, sursa: 'estimat' })
    expect(costCerere('conditions', 429, H({}))).toMatchObject({ unitati: 1, sursa: 'estimat' })
    expect(costCerere('conditions', 0, null)).toMatchObject({ unitati: 1, sursa: 'estimat' })
  })
})

describe('depășirea (429 / maxhits*)', () => {
  it('codurile oficiale, la 429 sau la 200 cu eroarea în corp', () => {
    expect(depasire(429, { error: { code: 'maxhits' } })).toBe('perioada')
    expect(depasire(429, { error: { code: 'maxhits_daily' } })).toBe('zi')
    expect(depasire(429, { error: { code: 'maxhits_min' } })).toBe('minut')
    expect(depasire(200, { success: false, error: { code: 'maxhits' } })).toBe('perioada')
    expect(depasire(429, null)).toBe('necunoscut')
    expect(depasire(503, null)).toBeNull()
    expect(depasire(200, { success: true, error: { code: 'warn_no_data' } })).toBeNull()
    expect(motivDepasire('zi', 429)).toBe('cota zilei (maxhits_daily, până la 00:00 UTC), HTTP 429')
  })
})

describe('contorul rulării și blocul `cota`', () => {
  it('adună pe endpoint, separă estimările, reține ultimele antete de cotă valide', () => {
    const c = contorNou()
    inregistreaza(c, 'conditions', 200, H({ 'X-Cost-Tokens': '1', 'X-RateLimit-Remaining-Period': '9000', 'X-RateLimit-Limit-Period': '15000',
      'X-RateLimit-Reset-Period': '2026-11-30T00:00:00Z', 'X-RateLimit-Limit-Period-Type': 'month', 'X-RateLimit-Limit-Minute': '100',
      'X-RateLimit-Remaining-Minute': '99' }), ACUM)
    inregistreaza(c, 'airquality', 200, H({ 'X-Cost-Tokens': '5', 'X-RateLimit-Remaining-Period': '8995' }), ACUM)
    inregistreaza(c, 'airquality', 200, H({}), ACUM)                       // estimat 5
    inregistreaza(c, 'conditions/summary', 503, H({ 'X-RateLimit-Remaining-Period': 'nu' }), ACUM)   // estimat 1; restul invalid ignorat
    expect([c.cereri, c.unitati, c.unitati_estimate, c.estimate, totalPrudent(c)]).toEqual([4, 6, 6, 2, 12])
    const b = blocCota(c)
    expect(b.perioada).toEqual({ limita: 15000, rest: 8995, resetare: '2026-11-30T00:00:00.000Z', tip: 'month' })
    expect(b.minut).toEqual({ limita: 100, rest: 99, resetare: null })
    expect(b.pe_endpoint.airquality).toEqual({ cereri: 2, unitati: 10, estimate: 1, cost_max: 5 })
    expect(b.cota_necunoscuta).toBe(false)
  })
  it('rezervarea unei zile-șantier: 1 + 1 implicit; crește după costul maxim văzut în antete', () => {
    const c = contorNou()
    expect(costZiSantier(c)).toBe(2)
    inregistreaza(c, 'observations/summary', 200, H({ 'X-Cost-Tokens': '3' }), ACUM)
    expect(costZiSantier(c)).toBe(4)
    expect(costEndpoint(c, 'airquality')).toBe(5)
  })
})

describe('configurarea', () => {
  it('XW_AER_PE_ZI: 0..4; lipsă = 4; altceva = 4 + semnalat', () => {
    for (const v of ['0', '1', '2', '3', '4']) expect(aerPeZi(v)).toEqual({ n: Number(v), invalid: null, sursa: 'setata' })
    expect(aerPeZi(undefined)).toEqual({ n: 4, invalid: null, sursa: 'implicita' })
    // r6: șirul gol nu mai trece neobservat (verdictul r5): invalid → implicita, cu sursa spusă
    expect(aerPeZi('')).toEqual({ n: 4, invalid: '', sursa: 'invalida' })
    expect(aerPeZi('5')).toEqual({ n: 4, invalid: '5', sursa: 'invalida' })
    expect(aerPeZi(' 1')).toEqual({ n: 4, invalid: ' 1', sursa: 'invalida' })
  })
  it('orele aerului: 4 → 04/10/16/22; 2 → 04/16; 1 → 04; 0 → niciodată; manual: dacă n ≥ 1', () => {
    expect([4, 10, 16, 22].map(o => cereAer(4, o, false))).toEqual([true, true, true, true])
    expect([4, 10, 16, 22].map(o => cereAer(2, o, false))).toEqual([true, false, true, false])
    expect([4, 10, 16, 22].map(o => cereAer(1, o, false))).toEqual([true, false, false, false])
    expect([4, 10, 16, 22].map(o => cereAer(0, o, false))).toEqual([false, false, false, false])
    expect([cereAer(0, 7, true), cereAer(1, 7, true)]).toEqual([false, true])
  })
  it('XW_ZILNIC_ACTIV: doar exact „1”', () => {
    expect(zilnicActiv('1')).toBe(true)
    for (const v of [undefined, null, '', '0', 'true', '01', ' 1', '1 ']) expect(zilnicActiv(v)).toBe(false)
  })
})

describe('garda de cotă', () => {
  it('costul pe zi al vremii curente (19 ținte): 760 / 570 / 475 / 380 cu aerul de 4 / 2 / 1 / 0 ori (calculul din brief)', () => {
    expect([4, 2, 1, 0].map(a => costZiVremeCurenta(19, a))).toEqual([760, 570, 475, 380])
  })
  it('rest suficient: disponibil = rest − cost/zi × zile (rotunjite în sus) − marja; plafonul = min(60, disponibil)', () => {
    const c = contorNou()
    // resetare peste 9,5 zile → 10 zile; aerul o dată: 475 × 10 + 300 = 5.050
    inregistreaza(c, 'conditions', 200, H({ 'X-Cost-Tokens': '1', 'X-RateLimit-Remaining-Period': '10000',
      'X-RateLimit-Reset-Period': new Date(ACUM + 9.5 * 864e5).toISOString() }), ACUM)
    expect(gardaCota(c, { acum: ACUM, tinte: 19, aer: 1 })).toMatchObject({ cunoscuta: true, zile: 10, cost_zi_vreme_curenta: 475, rezerva: 5050,
      marja: MARJA_COTA, disponibil: 4950, plafon: MAX_UNITATI_XW_RULARE })
    expect(incapeInCota(c, 2, { acum: ACUM, tinte: 19, aer: 1 })).toBeNull()
  })
  it('rest insuficient: plafon 0 și fiecare zi „neajunsă (rezerva de cotă …)”; cu aerul de 4 ori, 9.000 rămase pe 10 zile nu ajung', () => {
    const c = contorNou()
    inregistreaza(c, 'conditions', 200, H({ 'X-Cost-Tokens': '1', 'X-RateLimit-Remaining-Period': '7000',
      'X-RateLimit-Reset-Period': new Date(ACUM + 10 * 864e5).toISOString() }), ACUM)
    // 760 × 10 + 300 = 7.900 > 7.000
    expect(gardaCota(c, { acum: ACUM, tinte: 19, aer: 4 })).toMatchObject({ rezerva: 7900, disponibil: -900, plafon: 0 })
    expect(incapeInCota(c, 2, { acum: ACUM, tinte: 19, aer: 4 })).toBe(NEAJUNSA_COTA)
  })
  it('fără rest sau fără resetare: cota necunoscută → plafonul mic declarat (10)', () => {
    const c = contorNou()
    expect(gardaCota(c, { acum: ACUM, tinte: 19, aer: 4 })).toMatchObject({ cunoscuta: false, plafon: PLAFON_COTA_NECUNOSCUTA })
    inregistreaza(c, 'conditions', 200, H({ 'X-RateLimit-Remaining-Period': '9000' }), ACUM)
    expect(gardaCota(c, { acum: ACUM, tinte: 19, aer: 4 })).toMatchObject({ cunoscuta: false, plafon: 10 })
    expect(blocCota(c).cota_necunoscuta).toBe(true)
  })
  it('costurile din antete înlocuiesc estimarea (aerul văzut la 10 → 19 × (12 + 8 + 4 × 10) = 1.140)', () => {
    const c = contorNou()
    inregistreaza(c, 'airquality', 200, H({ 'X-Cost-Tokens': '10' }), ACUM)
    expect(gardaCota(c, { acum: ACUM, tinte: 19, aer: 4 }).cost_zi_vreme_curenta).toBe(1140)
  })
})

describe('rotația cozii (P1: coada nu se mai poate înfometa)', () => {
  const IERI = '2026-11-12'
  const s = (i, tinta = 'raport', zi = null) => ({ site_id: 1 + (i % 5), lat: 44, lng: 26, zi: zi ?? new Date(Date.parse('2026-11-10T12:00:00Z') - Math.floor(i / 5) * 864e5).toISOString().slice(0, 10), tip: 'nou', tinta })
  it('indexul zilei: 12.11.2026 = 20.769 de zile de la 01.01.1970 (calculat de mână: 56 × 365 + 14 bisecte + 315)', () => {
    expect(indexZi(IERI)).toBe(20769)
  })
  // r7: „ieri” nu mai e „mereu primul” (r5); din r6 are partea lui în primele `pas` poziții, iar din r7 părțile sunt împletite cu rotunjire
  // în ordinea de execuție (re-review r6, punctul 3)
  it('coada care încape în pas nu se rotește (ordinea „cele mai noi întâi” rămâne); „ieri” are locul lui în primele `pas` poziții', () => {
    const q = [s(0, 'activ', IERI), ...Array.from({ length: 10 }, (_, i) => s(i))]
    expect(rotesteCoada(q, IERI, 30)).toEqual({ sarcini: q, pornire: 0 })
    const r = rotesteCoada(q, IERI, 4)
    // rest 10 > 4 → pornire = ⌊fracția(20769 × 0,6180339887…) × 10⌋ = ⌊0,94791… × 10⌋ = 9 (calculat separat de cod)
    expect(r.pornire).toBe(9)
    // părțile la pas 4: 1 ieri + 3 restanțe (rezerva 2 + locul nefolosit de „ieri”); restanțe în primele m poziții = round(3m / 4):
    // m = 1..4 → 1, 2, 2, 3 (0,75 / 1,5 / 2,25 / 3, calculat de mână) → R R I R, apoi restul restanțelor
    expect(r.sarcini).toEqual([q[10], q[1], q[0], ...q.slice(2, 10)])
  })
  // teorema celor trei goluri: pentru 21 ≤ n < 34 puncte {kφ}, golul maxim ≤ ‖13φ‖ + ‖21φ‖ ≈ 0,0344 + 0,0213 = 0,0557 → × 80 ≈ 4,5 → ≤ 5 poziții
  it('punctul de pornire se mută în fiecare zi și acoperă coada (30 de zile consecutive, coadă de 80: golul maxim ≤ 5 poziții)', () => {
    const q = Array.from({ length: 80 }, (_, i) => s(i))
    const porniri = Array.from({ length: 30 }, (_, k) => rotesteCoada(q, new Date(Date.parse('2026-11-12T12:00:00Z') + k * 864e5).toISOString().slice(0, 10), 30).pornire)
    expect(new Set(porniri).size).toBe(30)
    const sortate = [...porniri].sort((a, b) => a - b)
    const goluri = sortate.map((p, i) => (i ? p - sortate[i - 1] : p + 80 - sortate[sortate.length - 1]))
    expect(Math.max(...goluri)).toBeLessThanOrEqual(5)
  })
  // simularea rulărilor zilnice: zilele fără date costă 1, cele bune 2 (și ies din coadă când sunt servite); plafonul 60, rezerva unei zile 2
  function rulari(coadaInitiala, ziStart, roteste, maxRulari = 40) {
    let coada = [...coadaInitiala]
    for (let k = 1; k <= maxRulari; k++) {
      const ieri = new Date(Date.parse('2026-11-12T12:00:00Z') + (ziStart + k) * 864e5).toISOString().slice(0, 10)
      const ordine = roteste(coada, ieri)
      let u = 0
      const servite = new Set()
      for (const x of ordine) {
        if (poateIncepeZi(u, 60, 0, 1e9, 2)) break
        if (x.buna) { u += 2; servite.add(x) } else u += 1
      }
      coada = coada.filter(x => !servite.has(x))
      if (!coada.some(x => x.buna)) return k
    }
    return Infinity
  }
  // 70 de zile fără date în fața a 10 bune (cel mai rău caz pentru „cele mai noi întâi”)
  const COADA = Array.from({ length: 80 }, (_, i) => ({ ...s(i), buna: i >= 70 }))
  it('70 fără date + 10 bune: cele 10 sunt servite în cel mult N = 2 rulări, oricare ar fi ziua de pornire (400 de zile încercate)', () => {
    const N = Math.max(...Array.from({ length: 400 }, (_, z) => rulari(COADA, z, (q, ieri) => rotesteCoada(q, ieri, 30).sarcini)))
    expect(N).toBeLessThanOrEqual(2)
  })
  it('mutant: rotația „(index × pas) mod lungime” (prima variantă) e mai slabă: cu plafonul mic ajunge la zeci de rulări', () => {
    const slab = (q, ieri) => { const o = (indexZi(ieri) * 5) % q.length; return [...q.slice(o), ...q.slice(0, o)] }
    let max = 0
    for (let z = 0; z < 80; z++) {
      let c = [...COADA]
      for (let k = 1; k <= 300; k++) {
        const ieri = new Date(Date.parse('2026-11-12T12:00:00Z') + (z + k) * 864e5).toISOString().slice(0, 10)
        let u = 0
        const serv = new Set()
        for (const x of slab(c, ieri)) { if (poateIncepeZi(u, 10, 0, 1e9, 2)) break; if (x.buna) { u += 2; serv.add(x) } else u += 1 }
        c = c.filter(x => !serv.has(x))
        if (!c.some(x => x.buna)) { max = Math.max(max, k); break }
      }
    }
    expect(max).toBeGreaterThan(26)
  })
  it('mutant: fără rotație, cele 10 bune nu sunt servite niciodată (zilele fără date ocupă plafonul în fiecare zi)', () => {
    expect(rulari(COADA, 0, (q) => q)).toBe(Infinity)
  })
  it('și cu plafonul mic (cota necunoscută: pas 5), toate cele bune sunt servite într-un număr mărginit de rulări', () => {
    let k = 0
    const simulare = (coada, z) => {
      let c = [...coada]
      for (k = 1; k <= 200; k++) {
        const ieri = new Date(Date.parse('2026-11-12T12:00:00Z') + (z + k) * 864e5).toISOString().slice(0, 10)
        let u = 0
        const servite = new Set()
        for (const x of rotesteCoada(c, ieri, 5).sarcini) {
          if (poateIncepeZi(u, 10, 0, 1e9, 2)) break
          if (x.buna) { u += 2; servite.add(x) } else u += 1
        }
        c = c.filter(x => !servite.has(x))
        if (!c.some(x => x.buna)) return k
      }
      return Infinity
    }
    // limita de jos e debitul: ≤ 9 zile-șantier pe rulare (zilele fără date costă 1) pentru 80 de sarcini; rotația dă cel mult 26 (400 de zile)
    const N = Math.max(...Array.from({ length: 400 }, (_, z) => simulare(COADA, z)))
    expect(N).toBeLessThanOrEqual(26)
  })
})
