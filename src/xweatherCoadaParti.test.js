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
    // poziția k e restanță dacă ⌊(k + 1) × 2 / 5⌋ > ⌊k × 2 / 5⌋: k = 2 și 4 (calculat de mână)
    expect(o.map(x => (esteIeri(x, IERI0) ? 'I' : 'R')).join('')).toBe('IIRIR')
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
