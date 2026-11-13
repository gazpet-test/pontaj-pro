// r6 — P1 din re-review r5: prioritatea fixă „ieri” putea înfometa complet restanțele. Acum, când există și „ieri” și restanțe, partiCoada
// rezervă restanțelor cel puțin ⌈pas / 3⌉ locuri (minimum 1), restul lui „ieri”; partea nefolosită trece celeilalte; rotația (φ) rămâne în
// interiorul fiecărei părți. Simulările de mai jos folosesc planul REAL (planXweather: activitate, reluarea pe 7 zile, fereastra de 31 de zile)
// și ordinea REALĂ (rotesteCoada), zi după zi; o zi servită = salvată (intră în „existente”). Cifrele așteptate sunt scrise de mână.
import { describe, it, expect } from 'vitest'
import { planXweather, rotesteCoada, partiCoada, esteIeri, fereastraZilnica, poateIncepeZi } from '../supabase/functions/meteo-sync/xweather_zilnic_logica.ts'
import { adunaZile } from '../supabase/functions/meteo-sync/istoric_logica.ts'

const IERI0 = '2026-11-12'
const zi = (k) => adunaZile(IERI0, k)

// active = câte șantiere active (1..A) au raport în FIECARE zi (deci câte o zi „ieri” nouă pe zi); vremea lor e salvată până la ieri0 − 1.
// restante = zilele-șantier vechi (cu raport, fără vreme) de pe șantierele 100.., la [ieri0 − dela, ieri0 − dela − n + 1]; dela = 15 ca
// șantierele lor să fie INACTIVE (ultimul raport > 14 zile) și zilele să fie în fereastră (≤ 30 de zile) la pornire.
// plafon / 2 = locurile pe rulare (fiecare zi costă 2, toate reușesc). roteste = ordinea (implicit cea reală).
function simuleaza({ plafon, active, restante, dela = 15, rulari = 31, start = 0, roteste = rotesteCoada }) {
  const sites = [], rapoarte = new Map(), existente = new Map()
  const santier = (id) => { sites.push({ id, lat: 44 + id / 1000, lng: 26, proiect_id: null }); rapoarte.set(String(id), new Set()); existente.set(String(id), new Map()) }
  for (let a = 1; a <= active; a++) {
    santier(a)
    for (let k = -40; k <= start; k++) rapoarte.get(String(a)).add(zi(k))
    for (let k = -40; k < start; k++) existente.get(String(a)).set(zi(k), {})
  }
  const vechi = new Set()
  restante.forEach((n, j) => {
    const id = 100 + j
    santier(id)
    for (let k = 0; k < n; k++) { const d = zi(start - dela - k); rapoarte.get(String(id)).add(d); vechi.add(`${id}|${d}`) }
  })
  const pas = Math.floor(plafon / 2)
  const pe = []
  let ramase = vechi.size, terminatLa = null
  for (let r = 0; r < rulari; r++) {
    const ieri = zi(start + r)
    for (let a = 1; a <= active; a++) rapoarte.get(String(a)).add(ieri)
    const plan = planXweather(sites, existente, new Map(), { mod: 'zilnic', ieri, rapoarte })
    const ord = roteste(plan.sarcini, ieri, pas).sarcini
    let u = 0
    const st = { ieri: 0, restante: 0, vechi: 0, coada: plan.sarcini.length }
    for (const s of ord) {
      if (poateIncepeZi(u, plafon, 0, 1e9, 2)) break
      u += 2
      existente.get(String(s.site_id)).set(s.zi, {})
      if (esteIeri(s, ieri)) st.ieri++; else st.restante++
      if (vechi.has(`${s.site_id}|${s.zi}`)) { st.vechi++; ramase-- }
    }
    pe.push(st)
    if (!ramase && terminatLa == null) terminatLa = r + 1
  }
  // zilele vechi care au ieșit din fereastră nesalvate (le semnalează restante_vechi)
  const jos = fereastraZilnica(zi(start + rulari - 1))
  const iesite = [...vechi].filter(k => !existente.get(k.split('|')[0]).has(k.split('|')[1]) && k.split('|')[1] < jos).length
  return { pe, terminatLa, servite: vechi.size - ramase, iesite, total: vechi.size }
}
// ordinea r5 (prioritatea fixă „ieri”, rotația doar pe rest) — pentru mutanți
const rotesteR5 = (sarcini, ieri, pas) => {
  const prime = sarcini.filter(s => esteIeri(s, ieri)), rest = sarcini.filter(s => !esteIeri(s, ieri))
  return { sarcini: [...prime, ...rest] }
}

describe('partiCoada: cifrele alese', () => {
  it('plafon 10 (pas 5): 2 restanțe + 3 ieri; plafon 60 (pas 30): 10 + 20; pas 2: 1 + 1; pas 3: 1 + 2', () => {
    expect(partiCoada(10, 50, 5, IERI0)).toEqual({ pas: 5, rezervat_restante: 2, rezervat_ieri: 3, ieri: 3, restante: 2 })
    expect(partiCoada(10, 50, 30, IERI0)).toEqual({ pas: 30, rezervat_restante: 10, rezervat_ieri: 20, ieri: 10, restante: 20 })
    expect(partiCoada(5, 5, 2, IERI0)).toMatchObject({ rezervat_restante: 1, rezervat_ieri: 1 })
    expect(partiCoada(5, 5, 3, IERI0)).toMatchObject({ rezervat_restante: 1, rezervat_ieri: 2 })
  })
  it('partea nefolosită trece celeilalte: 2 ieri la pas 5 → 3 restanțe; 1 restanță la pas 5 → 4 ieri; o singură parte = tot pasul', () => {
    expect(partiCoada(2, 50, 5, IERI0)).toMatchObject({ ieri: 2, restante: 3 })
    expect(partiCoada(10, 1, 5, IERI0)).toMatchObject({ ieri: 4, restante: 1 })
    expect(partiCoada(0, 50, 5, IERI0)).toMatchObject({ ieri: 0, restante: 5, rezervat_restante: 5 })
    expect(partiCoada(10, 0, 5, IERI0)).toMatchObject({ ieri: 5, restante: 0, rezervat_restante: 0 })
  })
  it('pas 1: locul alternează după paritatea zilei (nicio parte nu e exclusă două zile la rând)', () => {
    const a = partiCoada(3, 3, 1, '2026-11-12'), b = partiCoada(3, 3, 1, '2026-11-13')
    expect(a.restante + b.restante).toBe(1)
    expect(a.ieri + b.ieri).toBe(1)
  })
  it('împletirea: în primele 5 poziții exact 3 ieri + 2 restanțe, distribuite (nu toate restanțele la coadă)', () => {
    const s = (site_id, zi, tinta) => ({ site_id, lat: 44, lng: 26, zi, tip: 'nou', tinta })
    const q = [...Array.from({ length: 10 }, (_, i) => s(i + 1, IERI0, 'activ')), ...Array.from({ length: 10 }, (_, i) => s(50, zi(-10 - i), 'raport'))]
    const o = rotesteCoada(q, IERI0, 5).sarcini.slice(0, 5)
    // r7: restanțele din primele m poziții = round(m × 2 / 5): m = 1..5 → 0, 1, 1, 2, 2 → poziții 2 și 4 (calculat de mână): „IRIRI”
    expect(o.map(x => (esteIeri(x, IERI0) ? 'I' : 'R')).join('')).toBe('IRIRI')
  })
})

// r7 (re-review r6): rezervarea era pe capacitatea PLANIFICATĂ; o gardă de cotă actualizată după primele două poziții „ieri” putea opri
// rularea înaintea primei restanțe. Acum împărțirea ține în ORDINEA DE EXECUȚIE: oprire după k poziții (k = 1..n) → fiecare parte e la cel mult
// o poziție (de fapt ½) de proporția planificată pt.restante / (pt.ieri + pt.restante), până se epuizează una dintre părți.
describe('r7 — oprire după k poziții: părțile servite proporțional în orice prefix', () => {
  const s = (site_id, zi, tinta) => ({ site_id, lat: 44, lng: 26, zi, tip: 'nou', tinta })
  const coada = (nI, nR, ieri = IERI0) => [...Array.from({ length: nI }, (_, i) => s(i + 1, ieri, 'activ')), ...Array.from({ length: nR }, (_, i) => s(500, zi(-10 - i), 'raport'))]
  // abaterea maximă, pe toate prefixele, a numărului de restanțe față de proporția planificată (mărginită de epuizarea părților)
  function abatereMax(roteste, nI, nR, pas, ieri = IERI0) {
    const o = roteste(coada(nI, nR, ieri), ieri, pas).sarcini
    if (nI + nR <= pas) return 0
    const pt = partiCoada(nI, nR, pas, ieri)
    const p = pt.restante / (pt.ieri + pt.restante)
    let rest = 0, max = 0
    for (let k = 1; k <= o.length; k++) {
      if (!esteIeri(o[k - 1], ieri)) rest++
      const asteptat = Math.min(nR, k, Math.max(k - nI, 0, k * p))
      max = Math.max(max, Math.abs(rest - asteptat))
    }
    return max
  }
  const CAZURI = []
  for (const pas of [1, 2, 3, 4, 5, 7, 10, 30]) for (const nI of [0, 1, 2, 3, 10, 20]) for (const nR of [0, 1, 2, 4, 5, 10, 13, 50]) CAZURI.push([pas, nI, nR])
  // r8: garanția exactă — în orice prefix de k ≥ 1 poziții numărul de restanțe e ⌊așteptat⌋ sau ⌈așteptat⌉ (abatere < 1 poziție), iar când
  // „ieri” are loc în rulare (pt.ieri ≥ 1) prima poziție e „ieri”
  function verificaGarantia(roteste, nI, nR, pas, ieri) {
    const o = roteste(coada(nI, nR, ieri), ieri, pas).sarcini
    if (nI + nR <= pas) return nI ? esteIeri(o[0], ieri) : true
    const pt = partiCoada(nI, nR, pas, ieri)
    if (pt.ieri >= 1 && !esteIeri(o[0], ieri)) return false
    const p = pt.restante / (pt.ieri + pt.restante)
    let rest = 0
    for (let k = 1; k <= o.length; k++) {
      if (!esteIeri(o[k - 1], ieri)) rest++
      const asteptat = Math.min(nR, k, Math.max(k - nI, 0, k * p))
      if (rest < Math.floor(asteptat + 1e-9) || rest > Math.ceil(asteptat - 1e-9)) return false
    }
    return true
  }
  it(`oricare k = 1..n, ${CAZURI.length} combinații (pas, ieri, restanțe), două zile de pornire: „ieri” primul când are loc; restanțele ⌊…⌋ sau ⌈…⌉ (abatere < 1)`, () => {
    for (const ieri of [IERI0, zi(1)]) for (const [pas, nI, nR] of CAZURI) {
      expect(verificaGarantia(rotesteCoada, nI, nR, pas, ieri), `${pas}/${nI}/${nR}`).toBe(true)
      expect(abatereMax(rotesteCoada, nI, nR, pas, ieri), `${pas}/${nI}/${nR}`).toBeLessThan(1)
    }
  })
  it('pas 1: „ieri” primul doar în zilele în care locul e al lui (paritatea zilei); altfel restanța', () => {
    for (const ieri of [IERI0, zi(1)]) {
      const pt = partiCoada(3, 3, 1, ieri), o = rotesteCoada(coada(3, 3, ieri), ieri, 1).sarcini
      expect(esteIeri(o[0], ieri)).toBe(pt.ieri === 1)
    }
  })
  it('r8 — contraexemplul recenzentului: plafon 10 (pas 5), 1 ieri + 10 restanțe → împărțirea 1 + 4, ordinea „IRRRR” (în r7: „RRIRR”)', () => {
    const pt = partiCoada(1, 10, 5, IERI0)
    expect(pt).toMatchObject({ ieri: 1, restante: 4 })
    // restanțe în primele m poziții = min(round(4m / 5), m − 1): m = 1..5 → min(1, 0), min(2, 1), min(2, 2), min(3, 3), min(4, 4) (de mână)
    expect(rotesteCoada(coada(1, 10), IERI0, 5).sarcini.slice(0, 5).map(x => (esteIeri(x, IERI0) ? 'I' : 'R')).join('')).toBe('IRRRR')
  })
  it('r8 — mutant (prima poziție lăsată restanțelor = formula r7 fără limita m − 1): „RRIRR”, garanția pică', () => {
    const rotesteR7 = (sarcini, ieri, pas) => {
      const I = sarcini.filter(x => esteIeri(x, ieri)), R = sarcini.filter(x => !esteIeri(x, ieri))
      if (I.length + R.length <= pas) return { sarcini: [...I, ...R] }
      const pt = partiCoada(I.length, R.length, pas, ieri), tot = pt.ieri + pt.restante, out = []
      const pana = (m) => Math.floor((2 * m * pt.restante + tot) / (2 * tot))
      for (let k = 0, i = 0, r = 0; i < I.length || r < R.length; k++) {
        if ((pana(k + 1) > pana(k) && r < R.length) || i >= I.length) out.push(R[r++]); else out.push(I[i++])
      }
      return { sarcini: out }
    }
    expect(rotesteR7(coada(1, 10), IERI0, 5).sarcini.slice(0, 5).map(x => (esteIeri(x, IERI0) ? 'I' : 'R')).join('')).toBe('RRIRR')
    expect(verificaGarantia(rotesteR7, 1, 10, 5, IERI0)).toBe(false)
    expect(CAZURI.filter(([pas, nI, nR]) => !verificaGarantia(rotesteR7, nI, nR, pas, IERI0)).length).toBeGreaterThan(0)
  })
  it('cazul recenzentului: plafon 10 (pas 5, 3 + 2), oprire după 2 poziții → deja o restanță servită (în r6: zero)', () => {
    const o = rotesteCoada(coada(10, 10), IERI0, 5).sarcini.slice(0, 2)
    expect(o.filter(x => !esteIeri(x, IERI0))).toHaveLength(1)
  })
  it('mutant (împletirea r6 cu ⌊…⌋): oprire după 2 poziții = zero restanțe, abaterea 0,8 > ½', () => {
    const rotesteR6 = (sarcini, ieri, pas) => {
      const I = sarcini.filter(x => esteIeri(x, ieri)), R = sarcini.filter(x => !esteIeri(x, ieri))
      if (I.length + R.length <= pas) return { sarcini: [...I, ...R] }
      const pt = partiCoada(I.length, R.length, pas, ieri), tot = pt.ieri + pt.restante, out = []
      for (let k = 0, i = 0, r = 0; i < I.length || r < R.length; k++) {
        const vrea = Math.floor((k + 1) * pt.restante / tot) > Math.floor(k * pt.restante / tot)
        if ((vrea && r < R.length) || i >= I.length) out.push(R[r++]); else out.push(I[i++])
      }
      return { sarcini: out }
    }
    expect(rotesteR6(coada(10, 10), IERI0, 5).sarcini.slice(0, 2).filter(x => !esteIeri(x, IERI0))).toHaveLength(0)
    expect(abatereMax(rotesteR6, 10, 10, 5)).toBeCloseTo(0.8, 5)
  })
})

describe('contraexemplul recenzentului: plafon 10, zece șantiere active cu o zi nouă pe zi, plus restanțe', () => {
  // 20 de zile vechi (șantierele 100 și 101, inactive, câte 10 zile la 15..24 de zile în urmă, toate în fereastră la început)
  const caz = (o = {}) => simuleaza({ plafon: 10, active: 10, restante: [10, 10], ...o })
  it('în FIECARE din cele 31 de rulări: 3 zile „ieri” + 2 restanțe (partea lor), nu 5 + 0', () => {
    const { pe } = caz()
    expect(pe.every(x => x.ieri === 3 && x.restante === 2)).toBe(true)
  })
  it('restanțele vechi avansează: servite în 31 de rulări (față de zero în r5); cele care ies din fereastră sunt numărate', () => {
    const r = caz()
    expect(r.servite).toBeGreaterThan(0)
    expect(r.servite + r.iesite).toBe(r.total)
    // cifrele (deterministe, ziua de pornire 12.11): vezi raportul
    // sistemul e SUPRAÎNCĂRCAT (10 zile noi pe zi, 5 locuri): 7 zile „ieri” pe zi trec în restanțe și concurează cu cele vechi; din cele
    // 20 vechi, 10 sunt servite și 10 ies din fereastră (pornire 12.11) — acestea apar în restante_vechi (P2), nu dispar
    expect({ servite: r.servite, iesite: r.iesite }).toEqual({ servite: 10, iesite: 10 })
    expect(r.pe.reduce((a, x) => a + x.restante, 0)).toBe(62)
  })
  it('oricare ar fi ziua de pornire (60 încercate): cel puțin o zi veche servită, mereu 3 + 2 pe rulare', () => {
    for (let start = 0; start < 60; start++) {
      const r = caz({ start })
      expect(r.servite).toBeGreaterThan(0)
      expect(r.pe.every(x => x.ieri === 3 && x.restante === 2)).toBe(true)
    }
  })
  it('mutant (ordinea r5, prioritatea fixă „ieri”): zero zile vechi servite în 31 de rulări — exact contraexemplul', () => {
    const r = caz({ roteste: rotesteR5 })
    expect(r.servite).toBe(0)
    expect(r.pe.every(x => x.ieri === 5 && x.restante === 0)).toBe(true)
  })
})

describe('garanția în cifre (zilele reușesc; zilele „ieri” nu depășesc partea lor)', () => {
  it('plafon 60 (pas 30), 10 șantiere active: toate cele 10 „ieri” zilnic + 20 de restanțe pe rulare → B = 40 în ⌈40 / 20⌉ = 2 rulări', () => {
    for (let start = 0; start < 60; start++) {
      const r = simuleaza({ plafon: 60, active: 10, restante: [10, 10, 10, 10], start, rulari: 5 })
      expect(r.terminatLa).toBe(2)
      expect(r.pe.every(x => x.ieri === 10)).toBe(true)
    }
  })
  it('plafon 60, 20 de șantiere active (partea întreagă a lui „ieri”): restanțele tot primesc 10 pe rulare → B = 40 în 4 rulări', () => {
    const r = simuleaza({ plafon: 60, active: 20, restante: [10, 10, 10, 10], rulari: 6 })
    expect(r.terminatLa).toBe(4)
    expect(r.pe.slice(0, 4).every(x => x.ieri === 20 && x.restante === 10)).toBe(true)
  })
  it('plafon 10 (pas 5), 3 șantiere active: 3 „ieri” + 2 restanțe pe rulare → B = 10 în ⌈10 / 2⌉ = 5 rulări', () => {
    for (let start = 0; start < 60; start++) {
      const r = simuleaza({ plafon: 10, active: 3, restante: [10], start, rulari: 8 })
      expect(r.terminatLa).toBe(5)
      expect(r.pe.every(x => x.ieri === 3)).toBe(true)
    }
  })
  it('plafon 10, fără șantiere active: tot pasul la restanțe → B = 10 în 2 rulări', () => {
    expect(simuleaza({ plafon: 10, active: 0, restante: [10], rulari: 4 }).terminatLa).toBe(2)
  })
})

describe('scenariul vechi „70 fără date + 10 bune”, acum CU „ieri” prezent', () => {
  // 3 zile „ieri” noi în fiecare rulare (3 șantiere active), coada de 80 în spate; zilele fără date costă 1 și rămân în coadă
  const s = (i) => ({ site_id: 200 + (i % 5), lat: 44, lng: 26, zi: adunaZile('2026-11-10', -Math.floor(i / 5)), tip: 'nou', tinta: 'raport', buna: i >= 70 })
  const COADA = Array.from({ length: 80 }, (_, i) => s(i))
  function rulari(z, plafon, roteste = rotesteCoada, max = 60) {
    let c = [...COADA]
    for (let k = 1; k <= max; k++) {
      const ieri = adunaZile('2026-11-12', z + k)
      const prime = [1, 2, 3].map(id => ({ site_id: id, lat: 44, lng: 26, zi: ieri, tip: 'nou', tinta: 'activ', buna: true }))
      let u = 0, ieriServite = 0
      const serv = new Set()
      for (const x of roteste([...prime, ...c], ieri, Math.floor(plafon / 2)).sarcini) {
        if (poateIncepeZi(u, plafon, 0, 1e9, 2)) break
        if (x.buna) { u += 2; serv.add(x); if (x.tinta === 'activ') ieriServite++ } else u += 1
      }
      if (ieriServite !== 3) return { eroare: `rularea ${k}: ${ieriServite} ieri` }
      c = c.filter(x => !serv.has(x))
      if (!c.some(x => x.buna)) return { k }
    }
    return { k: Infinity }
  }
  // fără „ieri” (testul r5 din xweatherCotaAntete, neschimbat și verde): N ≤ 2 la plafon 60, ≤ 26 la plafon 10. Cu 3 zile „ieri” servite
  // în fiecare rulare, restanțele au 6 unități mai puțin (54 din 60, respectiv 4 din 10): debitul scade, dar nu se oprește.
  const N = (plafon) => Math.max(...Array.from({ length: 400 }, (_, z) => { const r = rulari(z, plafon, rotesteCoada, 400); if (r.eroare) throw new Error(r.eroare); return r.k }))
  it('plafon 60: cele 10 bune în cel mult N = 3 rulări (400 de zile de pornire), „ieri” servit integral în fiecare', () => {
    expect(N(60)).toBeLessThanOrEqual(3)
  })
  it('plafon 10: cele 10 bune în cel mult 102 rulări (măsurat, 400 de porniri), „ieri” servit integral în fiecare (3 = partea lui)', () => {
    // cazul-limită artificial: 70 de zile fără date care nu ies niciodată din coadă (în realitate ies din fereastră după ≤ 31 de zile)
    expect(N(10)).toBeLessThanOrEqual(102)
  })
  it('mutant: fără rotație în partea restanțelor, cele 10 bune nu sunt servite niciodată (plafon 60)', () => {
    const faraRotatie = (q, ieri) => ({ sarcini: [...q.filter(x => esteIeri(x, ieri)), ...q.filter(x => !esteIeri(x, ieri))] })
    expect(rulari(0, 60, faraRotatie, 100).k).toBe(Infinity)
  })
})
