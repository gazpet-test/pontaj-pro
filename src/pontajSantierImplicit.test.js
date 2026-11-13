// Șantierul implicit în pontaj = cel din ziua precedentă lucrată (TKT-2026-0360). Valorile așteptate sunt scrise de mână din cerere (L25);
// citirea e probată pe un server FALS care aplică filtrele ca PostgREST și taie la max-rows = 1000 (ca Supabase), indiferent de .limit().
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  esteZiLucrataCuSantier, ultimulSantierDinRanduri, santierImplicit, incarcaUltimulSantier,
  stareZiInitiala, reducerZi, cheiaListei, raspunsAplicabil, randulZilei, stareIstoric, propuneSantier, verificaSalvare,
  randPentruSalvare, treceFiltrulSantier, nealocati, incarcaRanduriZi, incarcaIstoricZi, salveazaRand, alocaSantierZi,
} from './pontajSantierImplicit.js'

// ── serverul fals: in / lt / not is null / or(check_in.not.is.null,norma.is.null) / order / limit, plafon de server 1000 ──
function serverFals(randuri, { maxRows = 1000, strica = null } = {}) {
  const cereri = []
  const sb = {
    from(tabel) {
      const q = { tabel, filtre: [], ord: [], lim: null }
      const b = {
        select() { return b },
        in(c, v) { q.filtre.push(r => v.includes(r[c])); q.in = v; return b },
        lt(c, v) { q.filtre.push(r => r[c] < v); return b },
        not(c, op, v) { if (op !== 'is' || v !== null) throw new Error('filtru neașteptat'); q.filtre.push(r => r[c] != null); return b },
        or(expr) { if (expr !== 'check_in.not.is.null,norma.is.null') throw new Error('or neașteptat: ' + expr); q.filtre.push(r => r.check_in != null || r.norma == null); return b },
        order(c, { ascending }) { q.ord.push([c, ascending]); return b },
        limit(n) { q.lim = n; return b },
        then(res, rej) {
          cereri.push(q)
          if (strica === 'eroare') return Promise.resolve({ data: null, error: { message: 'timeout' } }).then(res, rej)
          let rows = randuri.filter(r => q.filtre.every(f => f(r)))
          rows.sort((a, b2) => { for (const [c, asc] of q.ord) { if (a[c] !== b2[c]) return (a[c] < b2[c] ? -1 : 1) * (asc ? 1 : -1) } return 0 })
          rows = rows.slice(0, Math.min(q.lim ?? Infinity, maxRows))
          if (strica === 'ignora_filtrul') rows = randuri.slice(0, 3)
          return Promise.resolve({ data: rows, error: null }).then(res, rej)
        },
      }
      return b
    },
  }
  return { sb, cereri }
}
let nextId = 1
const r = (employee_id, date, site_id, extra = {}) => ({ id: nextId++, employee_id, date, site_id, check_in: `${date}T05:00:00Z`, norma: null, ...extra })
const absenta = (employee_id, date, site_id, norma) => r(employee_id, date, site_id, { check_in: null, norma })

describe('regula de alegere (afișare și salvare)', () => {
  it('ordinea: rândul zilei > ultima zi lucrată > fișa > nimic', () => {
    const emp = { id: 1, site_id: 10 }
    expect(santierImplicit({ rec: { site_id: 30 }, ultim: { site_id: 20, date: '2026-11-12' }, emp })).toEqual({ site_id: 30, sursa: 'zi', data: null })
    expect(santierImplicit({ rec: null, ultim: { site_id: 20, date: '2026-11-12' }, emp })).toEqual({ site_id: 20, sursa: 'precedent', data: '2026-11-12' })
    expect(santierImplicit({ rec: null, ultim: undefined, emp })).toEqual({ site_id: 10, sursa: 'fisa', data: null })
    expect(santierImplicit({ rec: null, ultim: undefined, emp: { id: 2, site_id: null } })).toEqual({ site_id: null, sursa: null, data: null })
  })
  it('rândul zilei fără șantier (ex. absență scrisă fără șantier) nu ascunde ziua precedentă', () => {
    expect(santierImplicit({ rec: { site_id: null, norma: 'CO' }, ultim: { site_id: 20, date: '2026-11-10' }, emp: { site_id: 10 } }).site_id).toBe(20)
  })
  it('alegerea manuală (rândul zilei) are prioritate chiar dacă diferă de ziua precedentă și de fișă', () => {
    expect(santierImplicit({ rec: { site_id: 99 }, ultim: { site_id: 20, date: '2026-11-12' }, emp: { site_id: 10 } }).site_id).toBe(99)
  })
  it('zi lucrată = șantier + (oră de intrare sau fără normă); absențele (CO / CM / LL) fără oră nu contează', () => {
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: 'x', norma: null })).toBe(true)
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: null })).toBe(true)     // alocare manuală pe zi, fără ore încă
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: 'CO' })).toBe(false)
    expect(esteZiLucrataCuSantier({ site_id: 5, check_in: null, norma: 'LL' })).toBe(false)
    expect(esteZiLucrataCuSantier({ site_id: null, check_in: 'x', norma: null })).toBe(false)
  })
})

describe('ultima zi lucrată, din rânduri', () => {
  it('cazurile din cerere: concediu între timp, prima zi a lunii, fără pontaj anterior, ziua aleasă și cele de după ignorate', () => {
    const rows = [
      r(1, '2026-10-28', 20), r(1, '2026-10-29', 20), absenta(1, '2026-10-30', 10, 'CO'), absenta(1, '2026-10-31', 10, 'CO'),
      r(2, '2026-10-31', 30), r(2, '2026-11-01', 31), r(2, '2026-11-03', 32),
    ]
    const m = ultimulSantierDinRanduri(rows, '2026-11-01')
    // 1: concediul (scris cu șantierul din fișă, 10) nu contează; ultima zi LUCRATĂ e 29.10, pe 20 — prima zi a lunii ia din luna trecută
    expect(m.get(1)).toEqual({ site_id: 20, date: '2026-10-29' })
    // 2: ziua aleasă (01.11) și cele de după nu contează
    expect(m.get(2)).toEqual({ site_id: 30, date: '2026-10-31' })
    expect(m.has(3)).toBe(false)
  })
  it('două rânduri în aceeași zi (în BD nu se poate, UNIQUE): câștigă ultimul scris (id mai mare)', () => {
    const a = r(7, '2026-11-12', 40), b = r(7, '2026-11-12', 41)
    expect(ultimulSantierDinRanduri([b, a], '2026-11-13').get(7).site_id).toBe(41)
  })
})

describe('citirea din BD: exactă și paginată', () => {
  it('cazurile din cerere, pe serverul fals', async () => {
    const rows = [
      r(1, '2026-10-29', 20), absenta(1, '2026-10-30', 10, 'CO'), absenta(1, '2026-11-02', 10, 'CM'),
      r(2, '2026-11-12', 30), r(2, '2026-11-13', 31),
      r(3, '2026-11-12', null), // fără șantier: nu contează
    ]
    const { sb } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, [1, 2, 3, 4], '2026-11-13')
    expect(m.get(1)).toEqual({ site_id: 20, date: '2026-10-29' })
    expect(m.get(2)).toEqual({ site_id: 30, date: '2026-11-12' })
    expect(m.has(3)).toBe(false)
    expect(m.has(4)).toBe(false)
  })
  it('peste plafonul de 1000: un angajat cu istoric lung și altul cu ultima zi foarte veche — fără trunchiere tăcută', async () => {
    const rows = []
    // angajatul 1: 1.500 de zile lucrate recent pe 50 (umple singur prima pagină)
    for (let i = 0; i < 1500; i++) rows.push(r(1, new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), 50))
    // angajatul 2: ultima zi lucrată acum 5 ani (în afara oricărei ferestre), apoi doar concediu
    rows.push(r(2, '2021-03-15', 60))
    for (let i = 0; i < 1200; i++) rows.push(absenta(2, new Date(Date.UTC(2022, 0, 1) + i * 86400000).toISOString().slice(0, 10), 10, 'CM'))
    const { sb, cereri } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, [1, 2], '2026-11-13')
    expect(m.get(1)).toEqual({ site_id: 50, date: '2026-02-08' })
    expect(m.get(2)).toEqual({ site_id: 60, date: '2021-03-15' })
    // a doua cerere doar pentru cel nerezolvat
    expect(cereri.length).toBe(2)
    expect(cereri[1].in).toEqual([2])
  })
  it('limita cerută peste plafonul serverului nu face să se piardă angajați (oprire la pagina goală, nu la „pagină scurtă”)', async () => {
    const rows = []
    // angajatul 1: 1.200 de zile recente (serverul dă doar 1.000 din 5.000 cerute = „pagină scurtă”); angajatul 2: o zi veche
    for (let i = 0; i < 1200; i++) rows.push(r(1, new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10), 80))
    rows.push(r(2, '2022-06-01', 81))
    const { sb, cereri } = serverFals(rows, { maxRows: 1000 })
    const m = await incarcaUltimulSantier(sb, [1, 2], '2026-11-13', { pas: 5000 })
    expect(m.get(1)).toEqual({ site_id: 80, date: '2026-04-14' })
    expect(m.get(2)).toEqual({ site_id: 81, date: '2022-06-01' })
    expect(cereri[0].lim).toBe(5000)
  })
  it('id-urile pe bucăți (URL scurt): fiecare cerere are cel mult `bucata` id-uri', async () => {
    const rows = Array.from({ length: 230 }, (_, i) => r(i + 1, '2026-11-12', 70))
    const { sb, cereri } = serverFals(rows)
    const m = await incarcaUltimulSantier(sb, rows.map(x => x.employee_id), '2026-11-13')
    expect(m.size).toBe(230)
    expect(Math.max(...cereri.map(q => q.in.length))).toBeLessThanOrEqual(100)
  })
  it('eroarea serverului NU e „fără pontaj anterior” (L18): aruncă', async () => {
    const { sb } = serverFals([], { strica: 'eroare' })
    await expect(incarcaUltimulSantier(sb, [1], '2026-11-13')).rejects.toThrow(/timeout/)
  })
  it('un răspuns care ignoră filtrul = eroare, nu buclă și nu valori greșite', async () => {
    const { sb } = serverFals([r(9, '2026-11-20', 1), r(9, '2026-11-21', 1), r(9, '2026-11-22', 1)], { strica: 'ignora_filtrul' })
    await expect(incarcaUltimulSantier(sb, [1], '2026-11-13')).rejects.toThrow(/în afara filtrului|altă ordine|fără angajații/)
  })
  it('zi invalidă = eroare', async () => {
    const { sb } = serverFals([])
    await expect(incarcaUltimulSantier(sb, [1], '13.11.2026')).rejects.toThrow(/invalidă/)
  })
})

// ══ r2 (review #1091): comportamentul paginii, pe aceleași funcții pe care le cheamă PontajPage ══
// „Pagina” de test = starea din reducerZi (ca useReducer: fiecare dispatch se aplică pe starea CURENTĂ, în ordinea sosirii) +
// pașii asincroni exportați, cu promisiuni pe care testul le rezolvă în ordinea aleasă de el.
function amanat() {
  let rezolva, respinge
  const p = new Promise((a, b) => { rezolva = a; respinge = b })
  return { p, rezolva, respinge }
}
const asteapta = () => new Promise(res => setTimeout(res, 0))
function pagina(ziInit, emps) {
  const pg = { st: stareZiInitiala(ziInit), emps, ziRef: ziInit, scrieri: [] }
  pg.dispatch = (a) => { pg.st = reducerZi(pg.st, a) }
  pg.cheie = () => cheiaListei(pg.emps)
  pg.schimbaZiua = (zi) => { pg.ziRef = zi; pg.dispatch({ tip: 'zi', zi }) }
  // pornește citirile zilei afișate (ca efectele paginii); întoarce promisiunile amânate, rezolvate de test
  pg.pornesteCitirile = () => {
    const zi = pg.st.zi, cheie = pg.cheie(), ids = pg.emps.map(e => e.id)
    const randuri = amanat(), istoric = amanat()
    const pr = incarcaRanduriZi({ zi, ids, dispatch: pg.dispatch, citeste: () => randuri.p })
    const pi = incarcaIstoricZi({ zi, cheie, ids, dispatch: pg.dispatch, citeste: () => istoric.p })
    return { randuri, istoric, gata: Promise.all([pr, pi]) }
  }
  pg.prop = (emp) => propuneSantier({ st: pg.st, cheie: pg.cheie(), emp })
  // salvarea: ca saveRecord (starea din momentul apăsării); scrie() = promisiune controlată sau răspuns imediat (ecoul rândului)
  pg.salveaza = (emp, fields, scrie) => salveazaRand({
    st: pg.st, cheie: pg.cheie(), emp, fields, dispatch: pg.dispatch, ziAfisata: () => pg.ziRef,
    uid: async () => 'u1', acum: () => 'T', scrie: (rand) => { pg.scrieri.push(rand); return scrie ? scrie(rand) : Promise.resolve({ data: { id: 900, ...rand }, error: null }) },
  })
  return pg
}
const ore = (zi) => ({ check_in: `${zi}T05:00:00Z`, check_out: `${zi}T14:00:00Z`, norma: null, lunch_break: true, diurna: false, meal_supplement: false })
const A = 20, B = 30

describe('(a) schimbarea zilei cu istoric întârziat + rând cu șantier NULL (P1-1)', () => {
  it('salvarea e refuzată cât istoricul zilei noi nu e citit, apoi trece cu șantierul CORECT (B), nu cu al zilei vechi (A)', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    const c13 = pg.pornesteCitirile()
    c13.randuri.rezolva({ data: [], error: null })
    c13.istoric.rezolva(new Map([[1, { site_id: A, date: '2026-11-12' }]]))
    await c13.gata
    expect(pg.prop(emp)).toEqual({ site_id: A, sursa: 'precedent', data: '2026-11-12' })

    // treci la 12.11: există un rând cu ore și șantier NULL; rândurile sosesc ÎNAINTEA istoricului
    pg.schimbaZiua('2026-11-12')
    const c12 = pg.pornesteCitirile()
    expect(pg.prop(emp).sursa).toBe('incarc') // nici rândurile nu sunt încă citite: nu se arată A
    c12.randuri.rezolva({ data: [{ id: 5, employee_id: 1, date: '2026-11-12', site_id: null, ...ore('2026-11-12') }], error: null })
    await asteapta()
    expect(pg.prop(emp)).toEqual({ site_id: null, sursa: 'incarc', data: null, asteapta: 'istoric' })
    const refuz = await pg.salveaza(emp, ore('2026-11-12'))
    expect(refuz.ok).toBe(false)
    expect(refuz.motiv).toMatch(/ultimul șantier pontat/)
    expect(pg.scrieri.length).toBe(0) // nimic scris pe A

    // istoricul corect al zilei 12 dă B
    c12.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-10' }]]))
    await c12.gata
    expect(pg.prop(emp)).toEqual({ site_id: B, sursa: 'precedent', data: '2026-11-10' })
    const ok = await pg.salveaza(emp, ore('2026-11-12'))
    expect(ok.ok).toBe(true)
    expect(pg.scrieri).toHaveLength(1)
    expect(pg.scrieri[0]).toMatchObject({ employee_id: 1, date: '2026-11-12', site_id: B })
  })
  it('salvarea „doar diurnă” (trimite tot rândul vechi, cu site_id NULL) nu scrie NULL peste șantierul afișat și nici altă zi', async () => {
    const emp = { id: 1, site_id: null }
    const pg = pagina('2026-11-12', [emp])
    const c = pg.pornesteCitirile()
    const rand = { id: 5, employee_id: 1, date: '2026-11-12', site_id: null, check_in: null, check_out: null, norma: null }
    c.randuri.rezolva({ data: [rand], error: null })
    c.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-10' }]]))
    await c.gata
    await pg.salveaza(emp, { ...rand, date: '2026-11-11', diurna: true, meal_supplement: false })
    expect(pg.scrieri[0]).toMatchObject({ employee_id: 1, date: '2026-11-12', site_id: B, diurna: true })
  })
  it('rândul zilei CU șantier nu depinde de istoric: se salvează și cât istoricul se citește', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-12', [emp])
    const c = pg.pornesteCitirile()
    c.randuri.rezolva({ data: [{ id: 5, employee_id: 1, date: '2026-11-12', site_id: 77, ...ore('2026-11-12') }], error: null })
    await asteapta()
    expect(stareIstoric(pg.st, pg.cheie())).toBe('incarc')
    const r = await pg.salveaza(emp, ore('2026-11-12'))
    expect(r.ok).toBe(true)
    expect(pg.scrieri[0].site_id).toBe(77)
  })
  it('rândurile zilei necitite (sau citirea lor eșuată) = salvare refuzată, nu „fără rând”', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-12', [emp])
    const c = pg.pornesteCitirile()
    c.istoric.rezolva(new Map([[1, { site_id: A, date: '2026-11-11' }]]))
    c.randuri.rezolva({ data: null, error: { message: 'timeout' } })
    await c.gata
    expect(pg.st.recsErr).toBe('timeout')
    const r = await pg.salveaza(emp, ore('2026-11-12'))
    expect(r.ok).toBe(false)
    expect(r.motiv).toMatch(/pontajul zilei/)
    expect(pg.scrieri.length).toBe(0)
  })
})

describe('(b) răspunsul unei salvări sosit după schimbarea zilei (P1-2)', () => {
  it('scrierea rămâne pe ziua de plecare; starea zilei noi nu e atinsă; pagina află că s-a salvat pe altă zi', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    const c13 = pg.pornesteCitirile()
    c13.randuri.rezolva({ data: [], error: null })
    c13.istoric.rezolva(new Map([[1, { site_id: A, date: '2026-11-12' }]]))
    await c13.gata

    const scriere = amanat()
    const pending = pg.salveaza(emp, ore('2026-11-13'), () => scriere.p)
    await asteapta()
    expect(pg.scrieri[0]).toMatchObject({ date: '2026-11-13', site_id: A })

    pg.schimbaZiua('2026-11-14')
    const c14 = pg.pornesteCitirile()
    c14.randuri.rezolva({ data: [], error: null })
    c14.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-13' }]]))
    await c14.gata
    const inainte = pg.st

    scriere.rezolva({ data: { id: 901, employee_id: 1, date: '2026-11-13', site_id: A, ...ore('2026-11-13') }, error: null })
    const r = await pending
    expect(r).toMatchObject({ ok: true, zi: '2026-11-13', altaZi: true })
    expect(pg.st).toBe(inainte) // nimic aplicat
    expect(pg.st.recs[1]).toBeUndefined()
    // următoarea salvare pe 14.11 nu preia șantierul rândului din 13.11
    expect(pg.prop(emp).site_id).toBe(B)
    await pg.salveaza(emp, ore('2026-11-14'))
    expect(pg.scrieri[1]).toMatchObject({ date: '2026-11-14', site_id: B })
  })
  it('alocarea sosită după schimbarea zilei: la fel (scrisă pe ziua ei, ignorată în ziua nouă)', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    const scriere = amanat()
    const pending = alocaSantierZi({ zi: '2026-11-13', emp, siteId: A, dispatch: pg.dispatch, ziAfisata: () => pg.ziRef, uid: async () => 'u1', scrie: () => scriere.p })
    pg.schimbaZiua('2026-11-14')
    scriere.rezolva({ data: { id: 902, employee_id: 1, date: '2026-11-13', site_id: A }, error: null })
    expect(await pending).toMatchObject({ ok: true, zi: '2026-11-13', altaZi: true })
    expect(pg.st.recs[1]).toBeUndefined()
  })
  it('un rând cu altă dată nu intră niciodată în ziua afișată (nici prin salvare, nici prin citire)', () => {
    let st = stareZiInitiala('2026-11-14')
    st = reducerZi(st, { tip: 'randSalvat', zi: '2026-11-14', rand: { employee_id: 1, date: '2026-11-13', site_id: A } })
    expect(st.recs[1]).toBeUndefined()
    st = reducerZi(st, { tip: 'randuri', zi: '2026-11-14', rows: [{ employee_id: 1, date: '2026-11-13', site_id: A }] })
    expect(st.recs[1]).toBeUndefined()
    // și dacă ar ajunge totuși (stare construită de mână), regula nu-l folosește
    const st2 = { ...st, recs: { 1: { employee_id: 1, date: '2026-11-13', site_id: A } } }
    expect(randulZilei(st2, 1)).toBe(null)
    expect(propuneSantier({ st: { ...st2, ist: { zi: '2026-11-14', cheie: '1', stare: 'gata', harta: new Map(), err: null } }, cheie: '1', emp: { id: 1, site_id: 10 } }).site_id).toBe(10)
  })
  it('răspunsul unei citiri a rândurilor pentru ziua părăsită nu înlocuiește rândurile zilei afișate', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    const c13 = pg.pornesteCitirile()
    pg.schimbaZiua('2026-11-14')
    const c14 = pg.pornesteCitirile()
    c14.randuri.rezolva({ data: [{ id: 7, employee_id: 1, date: '2026-11-14', site_id: 44 }], error: null })
    await asteapta()
    c13.randuri.rezolva({ data: [{ id: 6, employee_id: 1, date: '2026-11-13', site_id: A }], error: null })
    c13.istoric.rezolva(new Map())
    await asteapta()
    expect(pg.st.recs[1].site_id).toBe(44)
    expect(pg.st.recsZi).toBe('2026-11-14')
  })
})

describe('(c) două schimbări rapide de zi: contează doar ultima', () => {
  it('istoricele sosite în orice ordine: doar cel al zilei afișate intră', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    pg.schimbaZiua('2026-11-14'); const c14 = pg.pornesteCitirile()
    pg.schimbaZiua('2026-11-15'); const c15 = pg.pornesteCitirile()
    c15.randuri.rezolva({ data: [], error: null })
    c14.randuri.rezolva({ data: [], error: null })
    // al zilei 14 sosește primul: ignorat (ziua afișată e 15)
    c14.istoric.rezolva(new Map([[1, { site_id: A, date: '2026-11-13' }]]))
    await asteapta()
    expect(pg.prop(emp).sursa).toBe('incarc')
    c15.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-14' }]]))
    await asteapta()
    expect(pg.prop(emp)).toEqual({ site_id: B, sursa: 'precedent', data: '2026-11-14' })
  })
  it('și invers: istoricul zilei vechi sosit DUPĂ cel al zilei afișate nu-l suprascrie', async () => {
    const emp = { id: 1, site_id: 10 }
    const pg = pagina('2026-11-13', [emp])
    pg.schimbaZiua('2026-11-14'); const c14 = pg.pornesteCitirile()
    pg.schimbaZiua('2026-11-15'); const c15 = pg.pornesteCitirile()
    c15.randuri.rezolva({ data: [], error: null }); c14.randuri.rezolva({ data: [], error: null })
    c15.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-14' }]]))
    await asteapta()
    c14.istoric.respinge(new Error('târziu')) // nici eroarea zilei vechi nu strică ziua afișată
    await asteapta()
    expect(pg.prop(emp).site_id).toBe(B)
    expect(stareIstoric(pg.st, pg.cheie())).toBe('gata')
  })
  it('aceeași zi, lista de angajați schimbată: doar istoricul ultimei liste contează (cel vechi nu blochează și nu se folosește)', async () => {
    const e1 = { id: 1, site_id: 10 }, e2 = { id: 2, site_id: null }
    const pg = pagina('2026-11-13', [e1])
    const c1 = pg.pornesteCitirile()
    pg.emps = [e1, e2]
    const c2 = pg.pornesteCitirile()
    c2.randuri.rezolva({ data: [], error: null }); c1.randuri.rezolva({ data: [], error: null })
    c2.istoric.rezolva(new Map([[1, { site_id: B, date: '2026-11-12' }], [2, { site_id: A, date: '2026-11-11' }]]))
    await asteapta()
    c1.istoric.rezolva(new Map([[1, { site_id: 99, date: '2026-11-12' }]]))
    await asteapta()
    expect(pg.prop(e1).site_id).toBe(B)
    expect(pg.prop(e2).site_id).toBe(A)
  })
})

describe('(d) istoric cu eroare: avertisment + fișa (comportamentul păstrat)', () => {
  it('eroarea se vede (stare „eroare” + mesaj), propunerea e fișa marcată, salvarea pe fișă e permisă', async () => {
    const emp = { id: 1, site_id: 10 }, faraFisa = { id: 2, site_id: null }
    const pg = pagina('2026-11-13', [emp, faraFisa])
    const c = pg.pornesteCitirile()
    c.randuri.rezolva({ data: [], error: null })
    c.istoric.respinge(new Error('timeout'))
    await c.gata
    expect(stareIstoric(pg.st, pg.cheie())).toBe('eroare')
    expect(pg.st.ist.err).toBe('timeout')
    expect(pg.prop(emp)).toEqual({ site_id: 10, sursa: 'fisa', data: null, istoricEroare: true })
    expect(pg.prop(faraFisa)).toEqual({ site_id: null, sursa: null, data: null, istoricEroare: true })
    const r = await pg.salveaza(emp, ore('2026-11-13'))
    expect(r.ok).toBe(true)
    expect(pg.scrieri[0].site_id).toBe(10)
    const r2 = await pg.salveaza(faraFisa, ore('2026-11-13'))
    expect(r2).toMatchObject({ ok: false, motiv: 'Șantierul este obligatoriu pentru ore!' })
  })
})

describe('(e) „Nealocate” după regula nouă (P2) și filtrul pe șantier', () => {
  it('nealocat = fără rând cu șantier pe zi, fără zi lucrată anterioară, fără fișă; cât se încarcă, nu se dă lista', async () => {
    const precedent = { id: 1, name: 'P', site_id: null }   // fără fișă, dar a lucrat pe A
    const nimic = { id: 2, name: 'N', site_id: null }        // nimic nicăieri
    const randZi = { id: 3, name: 'R', site_id: null }       // rând cu șantier azi
    const fisa = { id: 4, name: 'F', site_id: 10 }           // doar fișa
    const randNull = { id: 5, name: 'Z', site_id: null }     // rând azi fără șantier, nimic altceva
    const emps = [precedent, nimic, randZi, fisa, randNull]
    const pg = pagina('2026-11-13', emps)
    const c = pg.pornesteCitirile()
    expect(nealocati({ st: pg.st, cheie: pg.cheie(), emps })).toEqual({ lista: [], inAsteptare: 5 })
    c.randuri.rezolva({ data: [{ id: 8, employee_id: 3, date: '2026-11-13', site_id: B }, { id: 9, employee_id: 5, date: '2026-11-13', site_id: null, norma: 'CO', check_in: null }], error: null })
    await asteapta()
    expect(nealocati({ st: pg.st, cheie: pg.cheie(), emps }).inAsteptare).toBe(4) // doar cel cu rând cu șantier e sigur
    c.istoric.rezolva(new Map([[1, { site_id: A, date: '2026-11-12' }]]))
    await c.gata
    const n = nealocati({ st: pg.st, cheie: pg.cheie(), emps })
    expect(n.inAsteptare).toBe(0)
    expect(n.lista.map(e => e.id)).toEqual([2, 5])
  })
  it('filtrul pe șantier: același șantier ca rândul; „se încarcă” rămâne vizibil', () => {
    expect(treceFiltrulSantier({ site_id: A, sursa: 'precedent' }, String(A))).toBe(true)
    expect(treceFiltrulSantier({ site_id: A, sursa: 'precedent' }, String(B))).toBe(false)
    expect(treceFiltrulSantier({ site_id: null, sursa: 'incarc' }, String(B))).toBe(true)
    expect(treceFiltrulSantier({ site_id: null, sursa: null }, String(B))).toBe(false)
    expect(treceFiltrulSantier({ site_id: null, sursa: null }, 'Toate')).toBe(true)
  })
})

describe('reguli mici', () => {
  it('verificaSalvare: „se încarcă” = refuz; ore fără șantier = refuz; absență fără șantier = permisă', () => {
    expect(verificaSalvare({ site_id: null, sursa: 'incarc', asteapta: 'istoric' }, ore('2026-11-13')).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: 'incarc', asteapta: 'istoric' }, { norma: 'CO' }).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: null }, ore('2026-11-13')).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: null }, { norma: 'CO' })).toEqual({ ok: true, site_id: null })
    expect(verificaSalvare({ site_id: A, sursa: 'precedent' }, ore('2026-11-13'))).toEqual({ ok: true, site_id: A })
  })
  it('randPentruSalvare: angajatul, ziua și șantierul decise nu pot fi suprascrise de câmpuri; restul câmpurilor trec', () => {
    expect(randPentruSalvare({ empId: 1, zi: '2026-11-13', siteId: A, uid: 'u', acum: 'T', fields: { employee_id: 9, date: '2026-01-01', site_id: null, diurna: true, created_by: 'vechi' } }))
      .toEqual({ employee_id: 1, date: '2026-11-13', site_id: A, created_by: 'vechi', updated_by: 'u', updated_at: 'T', diurna: true })
  })
  it('raspunsAplicabil: doar aceeași zi', () => {
    expect(raspunsAplicabil('2026-11-13', '2026-11-13')).toBe(true)
    expect(raspunsAplicabil('2026-11-13', '2026-11-14')).toBe(false)
    expect(raspunsAplicabil(null, null)).toBe(false)
  })
})

// legătura minimă cu ecranul: pagina chiar cheamă funcțiile probate mai sus (comportamentul e testat pe ele, nu pe text)
describe('PontajPage folosește funcțiile probate', () => {
  const APP = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8').replace(/\r/g, '')
  const start = APP.indexOf('function PontajPage()')
  const PAG = APP.slice(start, APP.indexOf('\nfunction ', start + 10))
  it('starea zilei prin reducer; nicio scriere directă în rânduri; toate căile prin funcțiile modulului', () => {
    expect(PAG).toContain('useReducer(reducerZi')
    expect(PAG).not.toContain('setRecs')
    for (const f of ['incarcaRanduriZi(', 'incarcaIstoricZi(', 'salveazaRand(', 'alocaSantierZi(', 'propuneSantier(', 'nealocati(', 'treceFiltrulSantier(', 'randulZilei(stZi,emp.id)'])
      expect(PAG).toContain(f)
    expect(PAG).not.toContain('emps.filter(e=>!e.site_id)')
  })
})
