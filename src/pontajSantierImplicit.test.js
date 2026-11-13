// Șantierul implicit în pontaj = cel din ziua precedentă lucrată (TKT-2026-0360). Valorile așteptate sunt scrise de mână din cerere (L25);
// citirea e probată pe un server FALS care aplică filtrele ca PostgREST și taie la max-rows = 1000 (ca Supabase), indiferent de .limit().
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  esteZiLucrataCuSantier, ultimulSantierDinRanduri, santierImplicit, incarcaUltimulSantier,
  cheiaListei, randulZilei, arataSpinner, propuneSantier, verificaSalvare, randPentruSalvare, treceFiltrulSantier, nealocati,
  creeazaControlorZi,
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

// ══ r3 (re-review #1091): CONTROLORUL zilei — același obiect pe care îl folosește PontajPage ══
// Fiecare citire / scriere e o promisiune amânată, eliberată de test în ordinea aleasă de el (răspunsuri întârziate, inversate, eșuate).
function amanat() {
  let rezolva, respinge
  const p = new Promise((a, b) => { rezolva = a; respinge = b })
  return { p, rezolva, respinge }
}
const asteapta = () => new Promise(res => setTimeout(res, 0))
// scrieImediat: scrierea răspunde imediat cu ecoul rândului (id 900+); altfel e amânată (scrieri[i].rezolva(...))
function banc(zi, emps, { scrieImediat = true } = {}) {
  const cereriR = [], cereriI = [], scrieri = []
  let idScris = 900
  const ctrl = creeazaControlorZi({
    zi,
    citesteRanduri: (z, ids) => { const d = amanat(); cereriR.push({ zi: z, ids, ...d }); return d.p },
    citesteIstoric: (ids, z) => { const d = amanat(); cereriI.push({ zi: z, ids, ...d }); return d.p },
    scrieRand: (rand) => {
      if (scrieImediat) { scrieri.push({ rand }); return Promise.resolve({ data: { id: idScris++, ...rand }, error: null }) }
      const d = amanat(); scrieri.push({ rand, ...d }); return d.p
    },
    uid: async () => 'u1', acum: () => 'T',
  })
  let notificari = 0
  ctrl.aboneaza(() => { notificari++ })
  if (emps) ctrl.seteazaAngajati(emps)
  return { ctrl, cereriR, cereriI, scrieri, s: () => ctrl.getStare(), prop: (e) => propuneSantier(ctrl.getStare(), e), notificari: () => notificari }
}
const ore = (zi, hh = '05') => ({ check_in: `${zi}T${hh}:00:00Z`, check_out: `${zi}T14:00:00Z`, norma: null, lunch_break: true, diurna: false, meal_supplement: false })
const harta = (...perechi) => new Map(perechi)
const A = 20, B = 30
const Z13 = '2026-11-13', Z12 = '2026-11-12'

describe('(a) A → B → A cu alocare pe B (P1-1 din re-review)', () => {
  it('la revenire, salvarea e refuzată până sosește istoricul NOU, apoi scrie șantierul nou (30), nu cel vechi (20)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null })
    b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    expect(b.prop(emp)).toEqual({ site_id: A, sursa: 'precedent', data: Z12 })

    // pe 12.11 aloci 30
    b.ctrl.seteazaZi(Z12)
    b.cereriR[1].rezolva({ data: [], error: null })
    b.cereriI[1].rezolva(harta([1, { site_id: 15, date: '2026-11-11' }]))
    await asteapta()
    const al = await b.ctrl.aloca(emp, B, { ctx: b.s().ctx })
    expect(al).toMatchObject({ ok: true, zi: Z12, altaZi: false })
    expect(b.prop(emp)).toEqual({ site_id: B, sursa: 'zi', data: null })

    // revii pe 13.11 (fără rând): rândurile sosesc, istoricul nou încă se citește → refuz, nimic scris
    b.ctrl.seteazaZi(Z13)
    expect(b.prop(emp).sursa).toBe('incarc') // nimic din ce s-a citit pe 13.11 înainte nu mai e folosit
    b.cereriR[2].rezolva({ data: [], error: null })
    await asteapta()
    expect(b.prop(emp)).toEqual({ site_id: null, sursa: 'incarc', data: null, asteapta: 'istoric' })
    const refuz = await b.ctrl.salveaza(emp, ore(Z13))
    expect(refuz).toMatchObject({ ok: false, scris: false })
    expect(refuz.motiv).toMatch(/ultimul șantier pontat/)
    expect(b.scrieri).toHaveLength(1) // doar alocarea

    b.cereriI[2].rezolva(harta([1, { site_id: B, date: Z12 }]))
    await asteapta()
    expect(b.prop(emp)).toEqual({ site_id: B, sursa: 'precedent', data: Z12 })
    const ok = await b.ctrl.salveaza(emp, ore(Z13))
    expect(ok).toMatchObject({ ok: true, zi: Z13 })
    expect(b.scrieri[1].rand).toMatchObject({ employee_id: 1, date: Z13, site_id: B })
  })
  it('alocarea pe B încă în zbor la revenirea pe A: istoricul citit ÎNAINTEA ei (20) e aruncat când alocarea reușește și se recitește', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    b.ctrl.seteazaZi(Z12)
    b.cereriR[1].rezolva({ data: [], error: null }); b.cereriI[1].rezolva(new Map())
    await asteapta()
    const pAl = b.ctrl.aloca(emp, B, { ctx: b.s().ctx })
    await asteapta()
    b.ctrl.seteazaZi(Z13)
    b.cereriR[2].rezolva({ data: [], error: null })
    b.cereriI[2].rezolva(harta([1, { site_id: A, date: Z12 }])) // citit înainte ca alocarea să ajungă în BD
    await asteapta()
    expect(b.prop(emp).site_id).toBe(A)
    // alocarea pe 12.11 (zi ANTERIOARĂ celei afișate) reușește → istoricul zilei 13 devine „se încarcă” și se recitește
    b.scrieri[0].rezolva({ data: { id: 50, employee_id: 1, date: Z12, site_id: B }, error: null })
    expect(await pAl).toMatchObject({ ok: true, zi: Z12, altaZi: true })
    expect(b.prop(emp).sursa).toBe('incarc')
    expect(b.cereriI).toHaveLength(4)
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(false)
    b.cereriI[3].rezolva(harta([1, { site_id: B, date: Z12 }]))
    await asteapta()
    expect(b.prop(emp).site_id).toBe(B)
  })
  it('o scriere pe ziua afișată sau pe una ULTERIOARĂ nu atinge istoricul (nu-l invalidează degeaba)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    const ist = b.s().istoric
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.scrieri[0].rezolva({ data: { id: 60, employee_id: 1, date: Z13, site_id: A }, error: null }); await p
    expect(b.s().istoric).toBe(ist)
    expect(b.cereriI).toHaveLength(1)
  })
})

describe('(b) răspunsul vechi pentru A sosit după cel nou nu schimbă nimic', () => {
  it('nici la rânduri, nici la istoric (A → B → A, răspunsurile primei vizite sosesc ultimele)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.ctrl.seteazaZi(Z12)
    b.ctrl.seteazaZi(Z13)
    expect(b.cereriR.map(c => c.zi)).toEqual([Z13, Z12, Z13])
    // cererile noi (a treia) răspund primele
    b.cereriR[2].rezolva({ data: [{ id: 7, employee_id: 1, date: Z13, site_id: 44 }], error: null })
    b.cereriI[2].rezolva(harta([1, { site_id: B, date: Z12 }]))
    await asteapta()
    const dupaNou = b.s()
    // răspunsurile vechi pentru ACEEAȘI zi (prima vizită) și pentru B sosesc după
    b.cereriR[0].rezolva({ data: [{ id: 6, employee_id: 1, date: Z13, site_id: 99 }], error: null })
    b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    b.cereriR[1].rezolva({ data: [], error: null })
    b.cereriI[1].respinge(new Error('târziu'))
    await asteapta()
    expect(b.s()).toBe(dupaNou)
    expect(b.prop(emp)).toEqual({ site_id: 44, sursa: 'zi', data: null })
    expect(b.s().istoric.harta.get(1).site_id).toBe(B)
  })
  it('și eroarea vechii cereri (aceeași zi) nu pune ziua în eroare', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.ctrl.seteazaZi(Z12); b.ctrl.seteazaZi(Z13)
    b.cereriR[2].rezolva({ data: [], error: null }); b.cereriI[2].rezolva(new Map())
    await asteapta()
    b.cereriR[0].rezolva({ data: null, error: { message: 'timeout' } }); b.cereriI[0].respinge(new Error('timeout'))
    await asteapta()
    expect(b.s().randuri.stare).toBe('gata')
    expect(b.s().istoric.stare).toBe('gata')
  })
})

describe('(c) aceeași zi, două liste de angajați, răspunsuri în ordine inversă', () => {
  it('rămâne rezultatul cererii noi: pontajul angajatului 2 nu dispare, iar salvarea lui nu-i scrie orele implicite', async () => {
    const e1 = { id: 1, site_id: 10 }, e2 = { id: 2, site_id: 10 }
    const b = banc(Z13, [e1])
    b.ctrl.seteazaAngajati([e1, e2])
    expect(b.cereriR.map(c => c.ids)).toEqual([[1], [1, 2]])
    const rand2 = { id: 8, employee_id: 2, date: Z13, site_id: 44, ...ore(Z13, '06') }
    b.cereriR[1].rezolva({ data: [rand2], error: null })
    b.cereriI[1].rezolva(harta([1, { site_id: A, date: Z12 }], [2, { site_id: B, date: Z12 }]))
    await asteapta()
    b.cereriR[0].rezolva({ data: [], error: null })
    b.cereriI[0].rezolva(harta([1, { site_id: 99, date: Z12 }]))
    await asteapta()
    expect(randulZilei(b.s(), 2)).toBe(rand2)
    expect(b.prop(e2)).toEqual({ site_id: 44, sursa: 'zi', data: null })
    expect(b.prop(e1).site_id).toBe(A)
  })
  it('lista schimbată după ce rândurile listei vechi erau citite: istoricul nou sosit ÎNAINTEA rândurilor nu deblochează salvarea', async () => {
    const e1 = { id: 1, site_id: 10 }, e2 = { id: 2, site_id: 10 }
    const b = banc(Z13, [e1])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(new Map())
    await asteapta()
    b.ctrl.seteazaAngajati([e1, e2])
    b.cereriI[1].rezolva(harta([2, { site_id: B, date: Z12 }]))
    await asteapta()
    // angajatul 2 poate avea deja pontaj azi: până nu sosesc rândurile listei noi nu se știe → refuz, nu ore implicite peste orele lui
    expect(b.prop(e2)).toEqual({ site_id: null, sursa: 'incarc', data: null, asteapta: 'randuri' })
    expect((await b.ctrl.salveaza(e2, ore(Z13))).ok).toBe(false)
    expect(b.scrieri).toHaveLength(0)
  })
  it('aceeași listă (alte obiecte, aceleași id-uri) = fără recitire; fișa nouă se folosește', async () => {
    const e1 = { id: 1, site_id: null }
    const b = banc(Z13, [e1])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(new Map())
    await asteapta()
    const ctx = b.s().ctx
    b.ctrl.seteazaAngajati([{ id: 1, site_id: 10 }])
    expect(b.cereriR).toHaveLength(1)
    expect(b.s().ctx).toBe(ctx)
    expect(b.prop(b.s().emps[0])).toEqual({ site_id: 10, sursa: 'fisa', data: null }) // pagina redă lista din instantaneu
  })
})

describe('(d) scrierile bat citirile plecate înaintea lor', () => {
  it('citirea de fundal plecată înaintea unei salvări și sosită după ea nu înlocuiește rândul salvat; se recitește', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    b.ctrl.reimprospateaza({ editari: false }) // nu se așteaptă: rămâne în zbor
    expect(b.cereriR).toHaveLength(2) // citirea de fundal a plecat
    const s = await b.ctrl.salveaza(emp, ore(Z13))
    expect(s.ok).toBe(true)
    expect(randulZilei(b.s(), 1)).toMatchObject({ date: Z13, site_id: A })
    expect(b.cereriR).toHaveLength(3) // citirea aruncată se reface
    b.cereriR[1].rezolva({ data: [], error: null }) // răspunsul vechi (fără rândul salvat)
    await asteapta()
    expect(randulZilei(b.s(), 1)).toMatchObject({ date: Z13, site_id: A })
    b.cereriR[2].rezolva({ data: [{ ...s.rand }], error: null })
    await asteapta()
    expect(randulZilei(b.s(), 1)).toMatchObject({ id: s.rand.id, site_id: A })
  })
  it('fără citire în zbor, salvarea nu pornește citiri inutile; citirea de fundal sare cât există editări (rânduri citite)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(new Map())
    await asteapta()
    await b.ctrl.salveaza(emp, ore(Z13))
    expect(b.cereriR).toHaveLength(1)
    await b.ctrl.reimprospateaza({ editari: true })
    expect(b.cereriR).toHaveLength(1)
  })
  it('salvarea după ce ziua s-a schimbat de la apăsare (poarta de parolă) = refuz, nimic scris', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(new Map())
    await asteapta()
    const ctx = b.s().ctx
    b.ctrl.seteazaZi(Z12)
    // ziua nouă e deja citită complet când se termină poarta: fără verificarea ctx, orele zilei 13 s-ar scrie pe 12
    b.cereriR[1].rezolva({ data: [], error: null }); b.cereriI[1].rezolva(harta([1, { site_id: B, date: '2026-11-11' }]))
    await asteapta()
    expect(b.prop(emp).sursa).toBe('precedent')
    expect(await b.ctrl.salveaza(emp, ore(Z13), { ctx })).toMatchObject({ ok: false, scris: false })
    expect(await b.ctrl.aloca(emp, B, { ctx })).toMatchObject({ ok: false })
    expect(b.scrieri).toHaveLength(0)
  })
})

describe('(e) eroare la citirea inițială + ore completate + „Reîncearcă”', () => {
  it('fără spinner (rândurile rămân montate, completările rămân), salvarea refuzată până la citire, apoi salvează ce a completat utilizatorul', async () => {
    const emp = { id: 1, site_id: 10 }, e2 = { id: 2, site_id: 10 }
    const b = banc(Z13, [emp, e2])
    expect(arataSpinner(b.s())).toBe(true) // prima citire a zilei
    b.cereriR[0].rezolva({ data: null, error: { message: 'timeout' } })
    b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    expect(b.s().randuri).toMatchObject({ stare: 'eroare', err: 'timeout' })
    expect(arataSpinner(b.s())).toBe(false) // lista e afișată: utilizatorul completează orele
    expect(b.prop(emp)).toMatchObject({ sursa: 'incarc', eroare: true })
    const completat = ore(Z13, '04') // ce a tastat utilizatorul (04:00, nu ora implicită)
    const refuz = await b.ctrl.salveaza(emp, completat)
    expect(refuz).toMatchObject({ ok: false, scris: false })
    expect(refuz.motiv).toMatch(/Reîncearcă/)
    // citirea de fundal reîncearcă ORICUM, deși există editări
    const pReinc = b.ctrl.reimprospateaza({ editari: true })
    expect(b.cereriR).toHaveLength(2)
    expect(b.s().randuri).toMatchObject({ stare: 'eroare', reincerc: true })
    expect(arataSpinner(b.s())).toBe(false) // reîncercarea NU demontează rândurile
    expect(randulZilei(b.s(), 1)).toBe(null) // rândul primit de PontajRow nu se schimbă → ce a tastat rămâne
    // angajatul 2 avea deja pontaj: apare cu valorile salvate, iar pagina e anunțată (randuriNoi)
    const rand2 = { id: 8, employee_id: 2, date: Z13, site_id: 44, ...ore(Z13, '06') }
    b.cereriR[1].rezolva({ data: [rand2], error: null })
    const rez = await pReinc
    expect(rez).toEqual({ randuri: 'gata', istoric: 'gata', randuriNoi: [2] })
    expect(randulZilei(b.s(), 1)).toBe(null)
    const ok = await b.ctrl.salveaza(emp, completat)
    expect(ok.ok).toBe(true)
    expect(b.scrieri[0].rand).toMatchObject({ employee_id: 1, date: Z13, site_id: A, check_in: `${Z13}T04:00:00Z` })
  })
  it('butonul „Reîncearcă” eșuat din nou rămâne în eroare (salvări oprite); istoricul în eroare se reîncearcă și el', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: null, error: { message: 'timeout' } })
    b.cereriI[0].respinge(new Error('cădere'))
    await asteapta()
    const p = b.ctrl.reincearca()
    expect(b.cereriR).toHaveLength(2); expect(b.cereriI).toHaveLength(2)
    b.cereriR[1].rezolva({ data: null, error: { message: 'iar' } })
    b.cereriI[1].rezolva(harta([1, { site_id: B, date: Z12 }]))
    expect(await p).toMatchObject({ randuri: 'eroare', istoric: 'gata', randuriNoi: [] })
    expect(b.s().randuri).toMatchObject({ stare: 'eroare', err: 'iar', reincerc: false })
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(false)
  })
})

describe('(f) cazurile din r2 rămân verzi, pe controlor', () => {
  it('schimbarea simplă A → B: rândul cu șantier NULL așteaptă istoricul zilei noi, apoi scrie B (nu A)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    b.ctrl.seteazaZi(Z12)
    expect(b.prop(emp).sursa).toBe('incarc')
    b.cereriR[1].rezolva({ data: [{ id: 5, employee_id: 1, date: Z12, site_id: null, ...ore(Z12) }], error: null })
    await asteapta()
    expect(b.prop(emp)).toEqual({ site_id: null, sursa: 'incarc', data: null, asteapta: 'istoric' })
    expect((await b.ctrl.salveaza(emp, ore(Z12))).ok).toBe(false)
    expect(b.scrieri).toHaveLength(0)
    b.cereriI[1].rezolva(harta([1, { site_id: B, date: '2026-11-10' }]))
    await asteapta()
    expect((await b.ctrl.salveaza(emp, ore(Z12))).ok).toBe(true)
    expect(b.scrieri).toHaveLength(1)
    expect(b.scrieri[0].rand).toMatchObject({ employee_id: 1, date: Z12, site_id: B })
  })
  it('salvarea „doar diurnă” (trimite tot rândul vechi, cu site_id NULL) nu scrie NULL peste șantierul afișat și nici altă zi', async () => {
    const emp = { id: 1, site_id: null }
    const b = banc(Z12, [emp])
    const rand = { id: 5, employee_id: 1, date: Z12, site_id: null, check_in: null, check_out: null, norma: null, lunch_break: false, notes: 'n', meal_supplement: false }
    b.cereriR[0].rezolva({ data: [rand], error: null })
    b.cereriI[0].rezolva(harta([1, { site_id: B, date: '2026-11-10' }]))
    await asteapta()
    await b.ctrl.salveaza(emp, { ...rand, date: '2026-11-11', diurna: true })
    expect(b.scrieri[0].rand).toMatchObject({ employee_id: 1, date: Z12, site_id: B, diurna: true, notes: 'n', lunch_break: false })
  })
  it('rândul zilei CU șantier nu depinde de istoric: se salvează și cât istoricul se citește', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z12, [emp])
    b.cereriR[0].rezolva({ data: [{ id: 5, employee_id: 1, date: Z12, site_id: 77, ...ore(Z12) }], error: null })
    await asteapta()
    expect(b.s().istoric.stare).toBe('incarc')
    expect((await b.ctrl.salveaza(emp, ore(Z12))).ok).toBe(true)
    expect(b.scrieri[0].rand.site_id).toBe(77)
  })
  it('răspunsul unei salvări sosit după schimbarea zilei: scris pe ziua de plecare, ziua nouă neatinsă, pagina află', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    const p = b.ctrl.salveaza(emp, ore(Z13))
    await asteapta()
    expect(b.scrieri[0].rand).toMatchObject({ date: Z13, site_id: A })
    b.ctrl.seteazaZi('2026-11-14')
    b.cereriR[1].rezolva({ data: [], error: null }); b.cereriI[1].rezolva(harta([1, { site_id: B, date: Z13 }]))
    await asteapta()
    const inainte = b.s()
    b.scrieri[0].rezolva({ data: { id: 901, employee_id: 1, date: Z13, site_id: A, ...ore(Z13) }, error: null })
    expect(await p).toMatchObject({ ok: true, zi: Z13, altaZi: true })
    // scrierea e pe 13.11 (ANTERIOARĂ zilei 14): rândurile zilei 14 neatinse; istoricul zilei 14 se recitește (poate depinde de 13.11)
    expect(b.s().randuri).toBe(inainte.randuri)
    expect(b.s().istoric.stare).toBe('incarc')
    b.cereriI[2].rezolva(harta([1, { site_id: A, date: Z13 }]))
    await asteapta()
    expect(b.prop(emp)).toEqual({ site_id: A, sursa: 'precedent', data: Z13 })
  })
  it('un rând cu altă dată nu intră niciodată în ziua afișată (nici prin citire, nici prin scriere)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc('2026-11-14', [emp], { scrieImediat: false })
    b.cereriR[0].rezolva({ data: [{ id: 3, employee_id: 1, date: Z13, site_id: A }], error: null })
    b.cereriI[0].rezolva(new Map())
    await asteapta()
    expect(randulZilei(b.s(), 1)).toBe(null)
    const p = b.ctrl.aloca(emp, A); await asteapta()
    b.scrieri[0].rezolva({ data: { id: 4, employee_id: 1, date: Z13, site_id: A }, error: null }) // ecou greșit
    await p
    expect(randulZilei(b.s(), 1)).toBe(null)
    expect(b.prop(emp).site_id).toBe(10)
  })
  it('istoric cu eroare: avertisment + fișa (comportamentul păstrat), salvarea pe fișă permisă', async () => {
    const emp = { id: 1, site_id: 10 }, faraFisa = { id: 2, site_id: null }
    const b = banc(Z13, [emp, faraFisa])
    b.cereriR[0].rezolva({ data: [], error: null })
    b.cereriI[0].respinge(new Error('timeout'))
    await asteapta()
    expect(b.s().istoric).toMatchObject({ stare: 'eroare', err: 'timeout' })
    expect(b.prop(emp)).toEqual({ site_id: 10, sursa: 'fisa', data: null, istoricEroare: true })
    expect(b.prop(faraFisa)).toEqual({ site_id: null, sursa: null, data: null, istoricEroare: true })
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(true)
    expect(b.scrieri[0].rand.site_id).toBe(10)
    expect(await b.ctrl.salveaza(faraFisa, ore(Z13))).toMatchObject({ ok: false, motiv: 'Șantierul este obligatoriu pentru ore!' })
  })
  it('„Nealocate” după regula nouă; cât se încarcă, nu se dă lista', async () => {
    const precedent = { id: 1, name: 'P', site_id: null }   // fără fișă, dar a lucrat pe A
    const nimic = { id: 2, name: 'N', site_id: null }        // nimic nicăieri
    const randZi = { id: 3, name: 'R', site_id: null }       // rând cu șantier azi
    const fisa = { id: 4, name: 'F', site_id: 10 }           // doar fișa
    const randNull = { id: 5, name: 'Z', site_id: null }     // rând azi fără șantier, nimic altceva
    const b = banc(Z13, [precedent, nimic, randZi, fisa, randNull])
    expect(nealocati(b.s())).toEqual({ lista: [], inAsteptare: 5 })
    b.cereriR[0].rezolva({ data: [{ id: 8, employee_id: 3, date: Z13, site_id: B }, { id: 9, employee_id: 5, date: Z13, site_id: null, norma: 'CO', check_in: null }], error: null })
    await asteapta()
    expect(nealocati(b.s()).inAsteptare).toBe(4)
    b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    const n = nealocati(b.s())
    expect(n.inAsteptare).toBe(0)
    expect(n.lista.map(e => e.id)).toEqual([2, 5])
  })
  it('lista încă necitită = „se încarcă” (spinner), lista goală = gata fără cereri', () => {
    const b = banc(Z13, null)
    expect(arataSpinner(b.s())).toBe(true)
    b.ctrl.seteazaZi(Z12)
    expect(b.cereriR).toHaveLength(0)
    b.ctrl.seteazaAngajati([])
    expect(arataSpinner(b.s())).toBe(false)
    expect(b.s().istoric.stare).toBe('gata')
    expect(b.cereriR).toHaveLength(0)
  })
  it('abonații sunt anunțați la fiecare schimbare', async () => {
    const b = banc(Z13, [{ id: 1, site_id: 10 }])
    const n0 = b.notificari()
    b.cereriR[0].rezolva({ data: [], error: null })
    await asteapta()
    expect(b.notificari()).toBeGreaterThan(n0)
  })
})

describe('reguli mici', () => {
  it('verificaSalvare: „se încarcă” = refuz; ore fără șantier = refuz; absență fără șantier = permisă', () => {
    expect(verificaSalvare({ site_id: null, sursa: 'incarc', asteapta: 'istoric' }, ore(Z13)).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: 'incarc', asteapta: 'istoric' }, { norma: 'CO' }).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: 'incarc', asteapta: 'randuri' }, ore(Z13)).motiv).toMatch(/pontajul zilei/)
    expect(verificaSalvare({ site_id: null, sursa: null }, ore(Z13)).ok).toBe(false)
    expect(verificaSalvare({ site_id: null, sursa: null }, { norma: 'CO' })).toEqual({ ok: true, site_id: null })
    expect(verificaSalvare({ site_id: A, sursa: 'precedent' }, ore(Z13))).toEqual({ ok: true, site_id: A })
  })
  it('randPentruSalvare: angajatul, ziua și șantierul decise nu pot fi suprascrise de câmpuri; restul câmpurilor trec', () => {
    expect(randPentruSalvare({ empId: 1, zi: Z13, siteId: A, uid: 'u', acum: 'T', fields: { employee_id: 9, date: '2026-01-01', site_id: null, diurna: true, created_by: 'vechi' } }))
      .toEqual({ employee_id: 1, date: Z13, site_id: A, created_by: 'vechi', updated_by: 'u', updated_at: 'T', diurna: true })
  })
  it('filtrul pe șantier: același șantier ca rândul; „se încarcă” rămâne vizibil', () => {
    expect(treceFiltrulSantier({ site_id: A, sursa: 'precedent' }, String(A))).toBe(true)
    expect(treceFiltrulSantier({ site_id: A, sursa: 'precedent' }, String(B))).toBe(false)
    expect(treceFiltrulSantier({ site_id: null, sursa: 'incarc' }, String(B))).toBe(true)
    expect(treceFiltrulSantier({ site_id: null, sursa: null }, String(B))).toBe(false)
    expect(treceFiltrulSantier({ site_id: null, sursa: null }, 'Toate')).toBe(true)
  })
  it('cheiaListei: aceleași id-uri în altă ordine = aceeași listă', () => {
    expect(cheiaListei([{ id: 2 }, { id: 1 }])).toBe(cheiaListei([{ id: 1 }, { id: 2 }]))
    expect(cheiaListei([{ id: 1 }])).not.toBe(cheiaListei([{ id: 1 }, { id: 2 }]))
  })
})

// Legătura cu ecranul. PontajPage nu se poate monta în vitest fără jsdom (nu e dependență) și fără să aducă tot App.jsx (Supabase, rute,
// ~9000 de linii); de aceea comportamentul e probat pe controlor (mai sus), iar aici se verifică, pe text, că pagina NU mai face nimic
// asincron pe rânduri / istoric în afara lui: doar îl creează, se abonează la el și îi cheamă metodele.
describe('PontajPage folosește doar controlorul', () => {
  const APP = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8').replace(/\r/g, '')
  const start = APP.indexOf('function PontajPage()')
  const PAG = APP.slice(start, APP.indexOf('\nfunction ', start + 10))
  it('controlorul creat o dată, abonare prin useSyncExternalStore; nicio stare / generație / zi proprie pentru rânduri și istoric', () => {
    expect(PAG).toContain('creeazaControlorZi(')
    expect(PAG).toContain('useSyncExternalStore(ctrl.aboneaza,ctrl.getStare)')
    for (const interzis of ['setRecs', 'useReducer', 'ziRef', 'dispatchZi', 'setEmps', 'setLoad', 'emps.filter(e=>!e.site_id)', 'loadRecs'])
      expect(PAG).not.toContain(interzis)
  })
  it('citirile / scrierile pe pontaj_records apar O SINGURĂ dată: în dependențele controlorului', () => {
    const cereri = PAG.split("from('pontaj_records')").length - 1
    expect(cereri).toBe(2) // citesteRanduri + scrieRand
    const bloc = PAG.slice(PAG.indexOf('creeazaControlorZi('), PAG.indexOf('const ctrl=ctrlRef.current'))
    expect(bloc.split("from('pontaj_records')").length - 1).toBe(2)
  })
  it('afișarea, filtrul, „Nealocate”, salvarea, alocarea și reîncercarea trec prin controlor / instantaneul lui', () => {
    for (const f of ['propuneSantier(snap,emp)', 'nealocati(snap)', 'treceFiltrulSantier(', 'randulZilei(snap,emp.id)', 'arataSpinner(snap)',
      'ctrl.salveaza(emp, fields, { ctx })', 'ctrl.aloca(emp, siteId, { ctx })', 'ctrl.reincearca()', 'ctrl.reimprospateaza(', 'ctrl.seteazaZi(', 'ctrl.seteazaAngajati('])
      expect(PAG).toContain(f)
    // contextul se ia la APĂSARE, înaintea porții de parolă
    for (const fn of ['const saveRecord = async', 'const allocate = async']) {
      const i = PAG.indexOf(fn)
      expect(PAG.indexOf('const ctx = snap.ctx', i)).toBeLessThan(PAG.indexOf('requestPasswordIfExported', i))
    }
  })
})
