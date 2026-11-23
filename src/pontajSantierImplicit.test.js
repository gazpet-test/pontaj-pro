// Șantierul implicit în pontaj = cel din ziua precedentă lucrată (TKT-2026-0360). Valorile așteptate sunt scrise de mână din cerere (L25);
// citirea e probată pe un server FALS care aplică filtrele ca PostgREST și taie la max-rows = 1000 (ca Supabase), indiferent de .limit().
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  esteZiLucrataCuSantier, ultimulSantierDinRanduri, santierImplicit, incarcaUltimulSantier,
  cheiaListei, randulZilei, arataSpinner, propuneSantier, verificaSalvare, randPentruSalvare, treceFiltrulSantier, nealocati,
  creeazaControlorZi, amprenta, valoriDinRand, valoriAfisate, stareRand, verificaIntentie, eroareDeterminista, creeazaDependentePontaj,
} from './pontajSantierImplicit.js'
// r5: biblioteca REALĂ a clientului bazei (deja dependență a aplicației), cu `fetch` simulat — nicio dependență nouă
import { createClient } from '@supabase/supabase-js'

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
const ORE = { intrare: '07:00', iesire: '16:00' }
// scrieImediat: scrierea răspunde imediat cu ecoul rândului (id 900+); altfel e amânată (scrieri[i].rezolva(...))
// exportImediat: „zi exportată?” răspunde imediat „nu”; altfel e amânată (cereriE[i].rezolva(...))
// uidManual: identitatea e amânată (uids[i].rezolva('u1')); timerele (termenele) se declanșează DOAR cu b.expira()
function banc(zi, emps, { scrieImediat = true, exportImediat = true, uidManual = false, poarta, noteaza, scrieFisa } = {}) {
  const cereriR = [], cereriI = [], cereriE = [], scrieri = [], uids = [], porti = [], timere = []
  let idScris = 900
  let nUid = 0
  const ctrl = creeazaControlorZi({
    zi,
    citesteRanduri: (z, ids) => { const d = amanat(); cereriR.push({ zi: z, ids, ...d }); return d.p },
    citesteIstoric: (ids, z) => { const d = amanat(); cereriI.push({ zi: z, ids, ...d }); return d.p },
    citesteExport: (z) => {
      if (exportImediat) { cereriE.push({ zi: z }); return Promise.resolve({ data: [], error: null }) }
      const d = amanat(); cereriE.push({ zi: z, ...d }); return d.p
    },
    scrieRand: (rand) => {
      if (scrieImediat) { scrieri.push({ rand }); return Promise.resolve({ data: { id: idScris++, ...rand }, error: null }) }
      const d = amanat(); scrieri.push({ rand, ...d }); return d.p
    },
    uid: () => { nUid++; if (!uidManual) return Promise.resolve('u1'); const d = amanat(); uids.push(d); return d.p },
    poarta: poarta || (async (a) => { porti.push(a); return { ok: true, tichet: null } }),
    noteaza, scrieFisa,
    oreImplicite: () => ORE,
    timer: (ms, fn) => { const t = { ms, fn, activ: true }; timere.push(t); return () => { t.activ = false } },
    acum: () => 'T',
  })
  let notificari = 0
  ctrl.aboneaza(() => { notificari++ })
  if (emps) ctrl.seteazaAngajati(emps)
  return {
    ctrl, cereriR, cereriI, cereriE, scrieri, uids, porti, s: () => ctrl.getStare(), prop: (e) => propuneSantier(ctrl.getStare(), e),
    notificari: () => notificari, nUid: () => nUid,
    // termenele: toate cele încă active expiră acum (cererile lor nu au răspuns)
    expira: () => { for (const t of timere.splice(0)) if (t.activ) { t.activ = false; t.fn() } },
    termeneActive: () => timere.filter(t => t.activ).length,
  }
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
  it('fără citire în zbor, salvarea nu pornește citiri inutile', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriR[0].rezolva({ data: [], error: null }); b.cereriI[0].rezolva(new Map())
    await asteapta()
    await b.ctrl.salveaza(emp, ore(Z13))
    expect(b.cereriR).toHaveLength(1)
    // r4: citirea de fundal NU mai sare peste editări (ele sunt protejate pe rând, la aplicarea răspunsului — vezi r4 (e))
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
    expect(rez).toEqual({ randuri: 'gata', istoric: 'gata', export: 'gata', randuriNoi: [2], fundalEroare: false })
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

// ══ r4 (re-review #1091 r3): scrieri serializate, „zi plătită” în controlor, versiunea rândului, termene, editări protejate ══
// pornire comună: rândurile și istoricul zilei citite (fără rând pentru angajat, istoric pe A)
async function pornit(b, { randuri = [], ist = harta([1, { site_id: A, date: Z12 }]) } = {}) {
  b.cereriR[0].rezolva({ data: randuri, error: null }); b.cereriI[0].rezolva(ist)
  await asteapta()
}
const rand = (id, extra = {}) => ({ id, employee_id: 1, date: Z13, site_id: A, check_in: null, check_out: null, norma: null, lunch_break: true, diurna: false, meal_supplement: false, updated_at: 'v' + id, ...extra })

describe('r4 (a) scrierile pe același rând se fac pe rând (P1-1)', () => {
  it('două alocări 20 → 30 cu răspunsuri care ar sosi inversat: a doua pleacă doar după prima; ecranul și salvarea următoare = 30', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p1 = b.ctrl.aloca(emp, 20); await asteapta()
    const p2 = b.ctrl.aloca(emp, 30); await asteapta()
    // a doua NU a plecat: ordinea din bază = ordinea de pe ecran, iar răspunsul ei nu poate sosi înaintea primului
    expect(b.scrieri).toHaveLength(1)
    expect(b.scrieri[0].rand.site_id).toBe(20)
    expect(stareRand(b.s(), 1)).toMatchObject({ salveaza: true, siteTinta: 30 })
    b.scrieri[0].rezolva({ data: rand(70, { site_id: 20, updated_at: 't1' }), error: null })
    expect(await p1).toMatchObject({ ok: true, scris: true })
    await asteapta()
    expect(b.scrieri).toHaveLength(2)
    expect(b.scrieri[1].rand.site_id).toBe(30)
    b.scrieri[1].rezolva({ data: rand(70, { site_id: 30, updated_at: 't2' }), error: null })
    expect(await p2).toMatchObject({ ok: true, scris: true })
    expect(b.prop(emp)).toEqual({ site_id: 30, sursa: 'zi', data: null })
    expect(stareRand(b.s(), 1).salveaza).toBe(false)
    const p3 = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    expect(b.scrieri[2].rand.site_id).toBe(30)
    b.scrieri[2].rezolva({ data: { ...rand(70, { site_id: 30, updated_at: 't3' }), ...ore(Z13) }, error: null })
    expect((await p3).ok).toBe(true)
  })
  it('o intenție nouă de același fel o înlocuiește pe cea nepornită (rămâne doar ultima); salvarea și alocarea așteaptă fiecare la rând', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p20 = b.ctrl.aloca(emp, 20); await asteapta()
    const p30 = b.ctrl.aloca(emp, 30); await asteapta()
    const pS = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    const p40 = b.ctrl.aloca(emp, 40); await asteapta()
    expect(await p30).toMatchObject({ ok: false, scris: false, inlocuita: true })
    expect(b.scrieri).toHaveLength(1)
    b.scrieri[0].rezolva({ data: rand(71, { site_id: 20, updated_at: 't1' }), error: null }); await p20; await asteapta()
    // ordinea sosirii: salvarea (cerută înaintea lui 40), apoi alocarea 40; 30 nu se mai scrie niciodată
    expect(b.scrieri[1].rand).toMatchObject({ site_id: 20, check_in: `${Z13}T05:00:00Z` })
    b.scrieri[1].rezolva({ data: { ...rand(71, { site_id: 20, updated_at: 't2' }), ...ore(Z13) }, error: null }); await pS; await asteapta()
    expect(b.scrieri[2].rand.site_id).toBe(40)
    b.scrieri[2].rezolva({ data: { ...rand(71, { site_id: 40, updated_at: 't3' }), ...ore(Z13) }, error: null })
    expect((await p40).ok).toBe(true)
    expect(b.scrieri.map(s => s.rand.site_id)).toEqual([20, 20, 40])
    expect(b.prop(emp).site_id).toBe(40)
  })
  it('rânduri diferite nu se așteaptă între ele', async () => {
    const e1 = { id: 1, site_id: 10 }, e2 = { id: 2, site_id: 10 }
    const b = banc(Z13, [e1, e2], { scrieImediat: false })
    await pornit(b)
    b.ctrl.aloca(e1, 20); b.ctrl.aloca(e2, 30); await asteapta()
    expect(b.scrieri.map(s => s.rand.employee_id)).toEqual([1, 2])
  })
})

describe('r4 (b) poarta „zi plătită” folosește starea ZILEI AFIȘATE, din controlor (P1-2)', () => {
  const PLATA = { period_from: '2026-11-01', period_to: '2026-11-12', payment_date: '2026-11-13', total_amount: 100 }
  it('A neexportată → B exportată, cu răspunsul de export întârziat: refuz până vine, apoi poarta primește exportat=true și cere parola', async () => {
    const emp = { id: 1, site_id: 10 }
    const porti = []
    // poarta reală a paginii cere parola (aici: refuzată) DOAR când primește exportat=true
    const poarta = async (a) => { porti.push(a); return a.exportat ? { ok: false, tichet: null } : { ok: true, tichet: null } }
    const b = banc(Z13, [emp], { exportImediat: false, poarta })
    b.cereriE[0].rezolva({ data: [], error: null })
    await pornit(b)
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(true)
    expect(porti[0]).toMatchObject({ zi: Z13, exportat: false })
    b.ctrl.seteazaZi(Z12)
    expect(b.s().exportZi.stare).toBe('incarc') // nimic din ziua precedentă
    b.cereriR[1].rezolva({ data: [], error: null }); b.cereriI[1].rezolva(harta([1, { site_id: A, date: '2026-11-11' }]))
    await asteapta()
    // rândurile și istoricul lui B au sosit înaintea răspunsului despre export → refuz, fără poartă și fără scriere
    const r = await b.ctrl.salveaza(emp, ore(Z12))
    expect(r).toMatchObject({ ok: false, scris: false })
    expect(r.motiv).toMatch(/Se verifică dacă ziua e plătită/)
    expect(porti).toHaveLength(1)
    expect(b.scrieri).toHaveLength(1)
    expect((await b.ctrl.aloca(emp, B)).ok).toBe(false)
    b.cereriE[1].rezolva({ data: [PLATA], error: null }); await asteapta()
    expect(b.s().exportZi).toMatchObject({ stare: 'gata', exportat: true, info: PLATA })
    const r2 = await b.ctrl.salveaza(emp, ore(Z12))
    expect(porti[1]).toEqual({ zi: Z12, exportat: true, info: PLATA, numeAngajat: undefined })
    expect(r2).toMatchObject({ ok: false, scris: false, anulat: true })
    expect(b.scrieri).toHaveLength(1)
  })
  it('răspunsul de export al zilei părăsite (A, „neexportată”) sosit după cel al lui B nu schimbă nimic', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { exportImediat: false })
    b.ctrl.seteazaZi(Z12)
    b.cereriE[1].rezolva({ data: [PLATA], error: null }); await asteapta()
    b.cereriE[0].rezolva({ data: [], error: null }); await asteapta()
    expect(b.s().exportZi).toMatchObject({ stare: 'gata', exportat: true })
  })
  it('eroarea verificării NU e „neexportată”: refuz (fără poartă), „Reîncearcă” → abia apoi se poate salva', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { exportImediat: false })
    b.cereriE[0].rezolva({ data: null, error: { message: 'cădere' } })
    await pornit(b)
    expect(b.s().exportZi).toMatchObject({ stare: 'eroare', err: 'cădere', exportat: null })
    const r = await b.ctrl.salveaza(emp, ore(Z13))
    expect(r).toMatchObject({ ok: false, scris: false, nivel: 'error' })
    expect(r.motiv).toMatch(/Nu s-a putut verifica dacă ziua e plătită/)
    expect(b.porti).toHaveLength(0)
    // un răspuns fără listă (null fără eroare) e tot eroare, nu „neexportată”
    const pR = b.ctrl.reimprospateaza()
    expect(b.s().exportZi.reincerc).toBe(true)
    b.cereriE[1].rezolva({ data: null, error: null })
    expect((await pR).export).toBe('eroare')
    const pR2 = b.ctrl.reincearca()
    b.cereriE[2].rezolva({ data: [], error: null })
    expect((await pR2).export).toBe('gata')
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(true)
  })
  it('poarta trecută cu tichet: nota se face pe ZIUA scrisă, cu câmpurile salvate; fișa goală primește șantierul la alocare', async () => {
    const emp = { id: 1, site_id: null, name: 'X' }
    const note = [], fise = []
    const b = banc(Z13, [emp], {
      poarta: async () => ({ ok: true, tichet: { id: 5, numar_tichet: 'TKT-1' } }),
      noteaza: async (a) => { note.push(a); return null },
      scrieFisa: async (id, s) => { fise.push([id, s]); return { error: null } },
    })
    await pornit(b, { ist: new Map() })
    const r = await b.ctrl.aloca(emp, B)
    expect(r.ok).toBe(true)
    expect(note[0]).toMatchObject({ zi: Z13, campuri: ['site_id'], tichet: { id: 5 } })
    expect(fise).toEqual([[1, B]])
    expect(b.s().emps[0].site_id).toBe(B)
    await b.ctrl.salveaza(emp, ore(Z13))
    expect(note[1]).toMatchObject({ zi: Z13, campuri: Object.keys(ore(Z13)) })
  })
})

describe('r4 (c) pontajul descoperit târziu, pe ACELAȘI angajat, nu e suprascris (P1-3)', () => {
  it('identitatea întârzie, o citire de fundal găsește pontajul la 06:00: nimic scris, conflict pe rând, 04:00 rămâne; „salvează din nou” scrie', async () => {
    const emp = { id: 1, site_id: 10, name: 'POP ION' }
    const b = banc(Z13, [emp], { uidManual: true })
    await pornit(b)
    b.ctrl.editeaza(emp, { ci: '04:00' })
    expect(valoriAfisate(b.s(), emp, ORE).ci).toBe('04:00')
    const p = b.ctrl.salveaza(emp, ore(Z13, '04')); await asteapta()
    expect(b.uids).toHaveLength(1) // intenția așteaptă identitatea
    b.ctrl.reimprospateaza()
    const r06 = rand(9, { check_in: `${Z13}T06:00:00Z`, check_out: `${Z13}T14:00:00Z` })
    b.cereriR[1].rezolva({ data: [r06], error: null }); await asteapta()
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: true, schimbat: true })
    b.uids[0].rezolva('u1')
    const r = await p
    expect(r).toMatchObject({ ok: false, scris: false, conflict: true })
    expect(r.motiv).toMatch(/Există deja un pontaj salvat la .* pentru POP ION/)
    expect(b.scrieri).toHaveLength(0)
    expect(valoriAfisate(b.s(), emp, ORE).ci).toBe('04:00')
    expect(stareRand(b.s(), 1).conflict).toMatch(/Există deja un pontaj salvat/)
    // utilizatorul a văzut conflictul și salvează din nou: acum intenția se sprijină pe rândul văzut (06:00)
    const p2 = b.ctrl.salveaza(emp, ore(Z13, '04')); await asteapta()
    b.uids[1].rezolva('u1')
    expect((await p2).ok).toBe(true)
    expect(b.scrieri[0].rand.check_in).toBe(`${Z13}T04:00:00Z`)
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: false, conflict: null })
  })
  it('scenariul din verdict: citirea inițială eșuează, 04:00 completat; salvarea e refuzată ÎNAINTE de identitate; reîncercarea găsește 06:00 pe același angajat → conflict, nimic scris', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { uidManual: true })
    b.cereriR[0].rezolva({ data: null, error: { message: 'timeout' } }); b.cereriI[0].rezolva(harta([1, { site_id: A, date: Z12 }]))
    await asteapta()
    b.ctrl.editeaza(emp, { ci: '04:00' })
    expect(stareRand(b.s(), 1).editat).toBe(true)
    expect((await b.ctrl.salveaza(emp, ore(Z13, '04'))).ok).toBe(false)
    expect(b.nUid()).toBe(0) // refuzul e imediat: nicio intenție nu rămâne să aștepte identitatea
    const pR = b.ctrl.reincearca()
    b.cereriR[1].rezolva({ data: [rand(9, { check_in: `${Z13}T06:00:00Z` })], error: null })
    await pR
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: true, schimbat: true })
    expect(valoriAfisate(b.s(), emp, ORE).ci).toBe('04:00')
    const r = await b.ctrl.salveaza(emp, ore(Z13, '04'))
    expect(r).toMatchObject({ ok: false, scris: false, conflict: true })
    expect(b.nUid()).toBe(0)
    expect(b.scrieri).toHaveLength(0)
  })
  it('alocarea: rândul schimbat de altcineva între alegere și scriere = conflict, nimic scris', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { uidManual: true })
    await pornit(b, { randuri: [rand(9)] })
    const p = b.ctrl.aloca(emp, B); await asteapta()
    b.ctrl.reimprospateaza()
    b.cereriR[1].rezolva({ data: [rand(9, { site_id: 77, updated_at: 'altcineva' })], error: null }); await asteapta()
    b.uids[0].rezolva('u1')
    expect(await p).toMatchObject({ ok: false, scris: false, conflict: true })
    expect(b.scrieri).toHaveLength(0)
    expect(stareRand(b.s(), 1).mesaj).toMatch(/alege din nou/)
  })
  it('propria scriere nu e conflict pentru intenția care o așteaptă (baza trece pe rândul scris de noi)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b, { randuri: [rand(9)] })
    b.ctrl.editeaza(emp, { co: '18:00' })
    const pA = b.ctrl.aloca(emp, B); await asteapta()
    const pS = b.ctrl.salveaza(emp, { ...ore(Z13), check_out: `${Z13}T18:00:00Z` }); await asteapta()
    b.scrieri[0].rezolva({ data: rand(9, { site_id: B, updated_at: 'noi' }), error: null }); await pA; await asteapta()
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: true, schimbat: false })
    expect(b.scrieri[1].rand).toMatchObject({ site_id: B, check_out: `${Z13}T18:00:00Z` })
    b.scrieri[1].rezolva({ data: rand(9, { site_id: B, check_out: `${Z13}T18:00:00Z`, updated_at: 'noi2' }), error: null })
    expect((await pS).ok).toBe(true)
    expect(stareRand(b.s(), 1).editat).toBe(false)
  })
})

describe('r4 (d) termene: nicio cerere nu blochează ziua (P2-4)', () => {
  it('citirea rândurilor suspendată: după termen = eroare cu „Reîncearcă”; răspunsul târziu e aruncat', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    b.cereriI[0].rezolva(new Map()); await asteapta()
    expect(b.s().randuri.stare).toBe('incarc')
    b.expira(); await asteapta()
    expect(b.s().randuri).toMatchObject({ stare: 'eroare', err: 'fără răspuns în 20 s' })
    const pR = b.ctrl.reimprospateaza()
    expect(b.cereriR).toHaveLength(2)
    b.cereriR[1].rezolva({ data: [], error: null })
    expect((await pR).randuri).toBe('gata')
    const dupa = b.s()
    b.cereriR[0].rezolva({ data: [rand(5, { site_id: 99 })], error: null }); await asteapta()
    expect(b.s()).toBe(dupa)
  })
  it('istoricul și „zi exportată” suspendate: eroare după termen (fișa, respectiv salvare refuzată), reîncercare reușită', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { exportImediat: false })
    b.cereriR[0].rezolva({ data: [], error: null }); await asteapta()
    b.expira(); await asteapta()
    expect(b.s().istoric.stare).toBe('eroare')
    expect(b.s().exportZi.stare).toBe('eroare')
    expect((await b.ctrl.salveaza(emp, ore(Z13))).motiv).toMatch(/Nu s-a putut verifica/)
    const pR = b.ctrl.reincearca()
    b.cereriI[1].rezolva(harta([1, { site_id: A, date: Z12 }])); b.cereriE[1].rezolva({ data: [], error: null })
    expect(await pR).toMatchObject({ istoric: 'gata', export: 'gata' })
    expect((await b.ctrl.salveaza(emp, ore(Z13))).ok).toBe(true)
  })
  it('scrierea expirată NU e eșec: rezultat necunoscut, recitire imediată, nicio altă scriere pe rând până la ea; răspunsul târziu recitește din nou', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    expect(b.scrieri).toHaveLength(1)
    b.expira()
    const r = await p
    expect(r).toMatchObject({ ok: false, scris: false, necunoscut: true })
    expect(stareRand(b.s(), 1).necunoscut).toBe(true)
    expect(b.cereriR).toHaveLength(2) // recitirea a plecat
    const r2 = await b.ctrl.salveaza(emp, ore(Z13, '06'))
    expect(r2).toMatchObject({ ok: false, scris: false })
    expect(r2.motiv).toMatch(/nu e cunoscut/)
    expect(b.scrieri).toHaveLength(1)
    // recitirea arată că scrierea a ajuns în bază
    const scris = rand(80, { ...ore(Z13) })
    b.cereriR[1].rezolva({ data: [scris], error: null }); await asteapta()
    expect(stareRand(b.s(), 1).necunoscut).toBe(false)
    expect(randulZilei(b.s(), 1)).toEqual(scris)
    // răspunsul târziu al scrierii: aruncat, dar pornește încă o recitire
    b.scrieri[0].rezolva({ data: scris, error: null }); await asteapta()
    expect(b.cereriR).toHaveLength(3)
    const p3 = b.ctrl.salveaza(emp, ore(Z13, '06')); await asteapta()
    expect(b.scrieri).toHaveLength(2)
    b.scrieri[1].rezolva({ data: rand(80, { ...ore(Z13, '06'), updated_at: 'x' }), error: null })
    expect((await p3).ok).toBe(true)
  })
  it('o citire pornită ÎNAINTE de expirare nu lămurește rezultatul necunoscut', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.ctrl.reimprospateaza() // pleacă înaintea expirării (cereriR[1])
    b.expira(); await p
    b.cereriR[1].rezolva({ data: [], error: null }); await asteapta() // aruncată (generație veche)
    expect(stareRand(b.s(), 1).necunoscut).toBe(true)
    b.cereriR[2].rezolva({ data: [], error: null }); await asteapta()
    expect(stareRand(b.s(), 1).necunoscut).toBe(false)
  })
  it('eroare de rețea (fără cod) = necunoscut; refuz al serverului (cu cod SQL) = eșec simplu', async () => {
    expect(eroareDeterminista({ code: '42501' })).toBe(true)
    expect(eroareDeterminista({ code: 'PGRST116' })).toBe(true)
    expect(eroareDeterminista({ code: '', message: 'TypeError: Failed to fetch' })).toBe(false)
    expect(eroareDeterminista(new Error('x'))).toBe(false)
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.scrieri[0].rezolva({ data: null, error: { code: '42501', message: 'refuz' } })
    expect(await p).toMatchObject({ ok: false, motiv: 'Eroare la salvare' })
    expect(stareRand(b.s(), 1).necunoscut).toBe(false)
    const p2 = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.scrieri[1].rezolva({ data: null, error: { code: '', message: 'Failed to fetch' } })
    expect(await p2).toMatchObject({ ok: false, necunoscut: true })
  })
  it('identitatea suspendată nu blochează rândul: după termen, refuz fără scriere', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { uidManual: true })
    await pornit(b)
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.expira()
    expect(await p).toMatchObject({ ok: false, scris: false })
    expect(b.scrieri).toHaveLength(0)
    expect(stareRand(b.s(), 1).salveaza).toBe(false)
  })
})

describe('r4 (e) editările în curs nu sunt suprascrise de răspunsurile de fundal (P2-5)', () => {
  it('răspuns de fundal cu rândul modificat de altcineva: câmpurile rămân, rândul e marcat, salvarea trece prin versiune', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    const r05 = rand(9, { ...ore(Z13) })
    await pornit(b, { randuri: [r05] })
    const p = b.ctrl.reimprospateaza() // citirea pleacă FĂRĂ editări
    b.ctrl.editeaza(emp, { co: '18:00' }) // editarea începe după pornirea citirii
    const v0 = valoriAfisate(b.s(), emp, ORE)
    const r06 = rand(9, { ...ore(Z13, '06'), updated_at: 'altcineva' })
    b.cereriR[1].rezolva({ data: [r06], error: null }); await p
    expect(randulZilei(b.s(), 1)).toEqual(r06)               // starea salvată se vede (marcaj de stare)
    expect(valoriAfisate(b.s(), emp, ORE)).toBe(v0)          // câmpurile NU sunt suprascrise
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: true, schimbat: true })
    const r = await b.ctrl.salveaza(emp, { ...ore(Z13), check_out: `${Z13}T18:00:00Z` })
    expect(r).toMatchObject({ ok: false, scris: false, conflict: true })
    expect(b.scrieri).toHaveLength(0)
    expect(valoriAfisate(b.s(), emp, ORE).co).toBe('18:00')
    expect((await b.ctrl.salveaza(emp, { ...ore(Z13), check_out: `${Z13}T18:00:00Z` })).ok).toBe(true)
  })
  it('răspuns de fundal identic: editarea nu e marcată; „ia valorile salvate” renunță la editare', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    const r05 = rand(9, { ...ore(Z13) })
    await pornit(b, { randuri: [r05] })
    b.ctrl.editeaza(emp, { diurna: true })
    b.ctrl.reimprospateaza(); b.cereriR[1].rezolva({ data: [{ ...r05 }], error: null }); await asteapta()
    expect(stareRand(b.s(), 1)).toMatchObject({ editat: true, schimbat: false })
    expect(valoriAfisate(b.s(), emp, ORE).diurna).toBe(true)
    b.ctrl.renuntaEditare(emp)
    expect(stareRand(b.s(), 1).editat).toBe(false)
    expect(valoriAfisate(b.s(), emp, ORE).diurna).toBe(false)
  })
  it('editarea readusă la valorile salvate dispare; schimbarea zilei renunță la editări (ca înainte)', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    await pornit(b)
    expect(valoriAfisate(b.s(), emp, ORE)).toEqual(valoriDinRand(null, ORE))
    b.ctrl.editeaza(emp, { ci: '04:00' }); b.ctrl.editeaza(emp, { ci: '07:00' })
    expect(stareRand(b.s(), 1).editat).toBe(false)
    b.ctrl.editeaza(emp, { ci: '04:00' })
    b.ctrl.seteazaZi(Z12)
    expect(b.s().ciorne).toEqual({})
  })
  it('un rând cu scriere în zbor își păstrează valoarea la o citire de fundal; după răspuns, ce a văzut citirea se recitește', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b, { randuri: [rand(9)] })
    const p = b.ctrl.aloca(emp, B); await asteapta()
    b.ctrl.reimprospateaza()
    b.cereriR[1].rezolva({ data: [rand(9, { site_id: 77, updated_at: 'altcineva' })], error: null }); await asteapta()
    expect(randulZilei(b.s(), 1)).toEqual(rand(9)) // neatins cât scrierea e în zbor
    b.scrieri[0].rezolva({ data: rand(9, { site_id: B, updated_at: 'noi' }), error: null }); await p
    expect(b.cereriR).toHaveLength(3) // se recitește: ordinea reală din bază nu se ghicește
  })
})

describe('r4 reguli pure', () => {
  it('amprenta: aceleași valori în altă ordine a cheilor = aceeași versiune; orice câmp schimbat = altă versiune', () => {
    expect(amprenta({ a: 1, b: 2 })).toBe(amprenta({ b: 2, a: 1 }))
    expect(amprenta({ a: 1, b: 2 })).not.toBe(amprenta({ a: 1, b: 3 }))
    expect(amprenta(null)).toBe('lipsa')
  })
  it('verificaIntentie: ordinea motivelor (zi → export → necunoscut → regula → versiune)', () => {
    const snap = { zi: Z13, ctx: 1, emps: [{ id: 1, site_id: 10 }], randuri: { stare: 'gata', recs: {} }, istoric: { stare: 'gata', harta: new Map() },
      exportZi: { stare: 'gata', exportat: false } }
    const it0 = { tip: 'salveaza', empId: 1, zi: Z13, ctx: 1, fields: ore(Z13), baza: 'lipsa', exportat: false }
    expect(verificaIntentie(snap, it0)).toEqual({ ok: true, site_id: 10 })
    expect(verificaIntentie(snap, { ...it0, ctx: 0 }).motiv).toMatch(/s-a schimbat/)
    expect(verificaIntentie({ ...snap, exportZi: { stare: 'incarc' } }, it0).motiv).toMatch(/Se verifică/)
    expect(verificaIntentie({ ...snap, exportZi: { stare: 'gata', exportat: true } }, it0).motiv).toMatch(/„zi plătită” s-a schimbat/)
    expect(verificaIntentie(snap, it0, { necunoscut: true }).motiv).toMatch(/nu e cunoscut/)
    expect(verificaIntentie(snap, { ...it0, baza: 'altceva' }).conflict).toBe(true)
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

// ══ r5 (re-review #1091 r4): dependențele sunt thenable LENEȘE, ca builder-ul PostgREST — fiecare .then() „trimite” încă o cerere ══
// thenableLenes nu are .catch / .finally (ca PromiseLike): controlorul nu are voie să-l atingă decât o dată, prin apel().
function bancLenes(zi, emps) {
  const trimise = []   // o intrare la FIECARE consumare: { nume, args, rezolva, respinge }
  const timere = []
  const lenes = (nume, args) => ({ then(res, rej) { const d = amanat(); trimise.push({ nume, args, ...d }); return d.p.then(res, rej) } })
  const ctrl = creeazaControlorZi({
    zi,
    citesteRanduri: (z, ids) => lenes('randuri', [z, ids]),
    citesteIstoric: (ids, z) => lenes('istoric', [ids, z]),
    citesteExport: (z) => lenes('export', [z]),
    scrieRand: (rand) => lenes('scrie', [rand]),
    uid: () => lenes('uid', []),
    poarta: (a) => lenes('poarta', [a]),
    noteaza: (a) => lenes('noteaza', [a]),
    scrieFisa: (empId, siteId) => lenes('fisa', [empId, siteId]),
    oreImplicite: () => ORE,
    timer: (ms, fn) => { const t = { fn, activ: true }; timere.push(t); return () => { t.activ = false } },
    acum: () => 'T',
  })
  if (emps) ctrl.seteazaAngajati(emps)
  const ale = (nume) => trimise.filter(x => x.nume === nume)
  return {
    ctrl, trimise, ale, s: () => ctrl.getStare(),
    nr: () => Object.fromEntries(['randuri', 'istoric', 'export', 'scrie', 'uid', 'poarta', 'noteaza', 'fisa'].map(n => [n, ale(n).length])),
    // răspunde ultimei cereri trimise de felul `nume`
    raspunde: async (nume, val) => { const l = ale(nume); l[l.length - 1].rezolva(val); await asteapta() },
    expira: () => { for (const t of timere.splice(0)) if (t.activ) { t.activ = false; t.fn() } },
  }
}
const nul = { randuri: 0, istoric: 0, export: 0, scrie: 0, uid: 0, poarta: 0, noteaza: 0, fisa: 0 }

describe('r5 (1) fiecare cerere logică consumă dependența EXACT o dată (L05 / L19)', () => {
  it('citirile (rânduri, istoric, „zi plătită”) și identitatea: o consumare pe cerere, și la expirare, și la răspunsul târziu', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = bancLenes(Z13, [emp]); await asteapta()
    expect(b.nr()).toEqual({ ...nul, randuri: 1, istoric: 1, export: 1 })
    b.expira(); await asteapta()
    expect(b.s().randuri.stare).toBe('eroare'); expect(b.s().istoric.stare).toBe('eroare'); expect(b.s().exportZi.stare).toBe('eroare')
    // răspunsurile târzii ale acelorași cereri: aruncate, fără nicio altă consumare
    b.ale('randuri')[0].rezolva({ data: [], error: null }); b.ale('istoric')[0].rezolva(new Map()); b.ale('export')[0].rezolva({ data: [], error: null })
    await asteapta()
    expect(b.nr()).toEqual({ ...nul, randuri: 1, istoric: 1, export: 1 })
    const pR = b.ctrl.reincearca(); await asteapta()
    expect(b.nr()).toEqual({ ...nul, randuri: 2, istoric: 2, export: 2 })
    await b.raspunde('randuri', { data: [], error: null }); await b.raspunde('istoric', harta([1, { site_id: A, date: Z12 }])); await b.raspunde('export', { data: [], error: null })
    expect(await pR).toMatchObject({ randuri: 'gata', istoric: 'gata', export: 'gata' })
    // identitatea expiră: o consumare, refuz fără scriere; răspunsul ei târziu nu mai consumă nimic
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    await b.raspunde('poarta', { ok: true, tichet: null })
    expect(b.nr()).toMatchObject({ uid: 1, poarta: 1, scrie: 0 })
    b.expira()
    expect(await p).toMatchObject({ ok: false, scris: false })
    await b.raspunde('uid', 'u1')
    expect(b.nr()).toEqual({ ...nul, randuri: 2, istoric: 2, export: 2, uid: 1, poarta: 1 })
  })
  it('scrierea expirată: O SINGURĂ cerere de scriere, și după răspunsul ei târziu; recitirile sunt câte o cerere fiecare', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = bancLenes(Z13, [emp]); await asteapta()
    await b.raspunde('randuri', { data: [], error: null }); await b.raspunde('istoric', harta([1, { site_id: A, date: Z12 }])); await b.raspunde('export', { data: [], error: null })
    const p = b.ctrl.salveaza(emp, ore(Z13, '04')); await asteapta()
    await b.raspunde('poarta', { ok: true, tichet: null }); await b.raspunde('uid', 'u1')
    expect(b.nr()).toMatchObject({ scrie: 1, randuri: 1 })
    b.expira()
    expect(await p).toMatchObject({ ok: false, necunoscut: true })
    await asteapta()
    expect(b.nr()).toMatchObject({ scrie: 1, randuri: 2 }) // recitirea pornită la expirare, fără nicio retrimitere
    b.ale('scrie')[0].rezolva({ data: rand(80, { ...ore(Z13, '04') }), error: null }); await asteapta()
    expect(b.nr()).toMatchObject({ scrie: 1, randuri: 3 }) // răspunsul târziu = încă o recitire, nu încă o scriere
  })
  it('alocarea cu tichet pe un angajat fără fișă: poarta, identitatea, scrierea, nota pe tichet și fișa — câte o consumare fiecare', async () => {
    const emp = { id: 1, site_id: null, name: 'POP ION' }
    const b = bancLenes(Z13, [emp]); await asteapta()
    await b.raspunde('randuri', { data: [], error: null }); await b.raspunde('istoric', new Map()); await b.raspunde('export', { data: [], error: null })
    const p = b.ctrl.aloca(emp, B); await asteapta()
    await b.raspunde('poarta', { ok: true, tichet: { id: 7, numar_tichet: 'TKT-1' } })
    await b.raspunde('uid', 'u1')
    await b.raspunde('scrie', { data: rand(50, { site_id: B }), error: null })
    await b.raspunde('noteaza', null)
    await b.raspunde('fisa', { error: null })
    expect(await p).toMatchObject({ ok: true, scris: true, notaEroare: null })
    expect(b.nr()).toEqual({ ...nul, randuri: 1, istoric: 1, export: 1, poarta: 1, uid: 1, scrie: 1, noteaza: 1, fisa: 1 })
    expect(b.ale('noteaza')[0].args[0]).toMatchObject({ tichet: { id: 7 }, zi: Z13, campuri: ['site_id'] })
    expect(b.ale('fisa')[0].args).toEqual([1, B])
  })
  it('scenariul recenzentului, pas cu pas: 04:00 expiră → o cerere; recitire; 06:00 salvat; răspunsul târziu al cererii ORIGINALE recitește; 04:00 nu mai pleacă', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = bancLenes(Z13, [emp]); await asteapta()
    await b.raspunde('randuri', { data: [], error: null }); await b.raspunde('istoric', harta([1, { site_id: A, date: Z12 }])); await b.raspunde('export', { data: [], error: null })
    // 1. salvarea 04:00 expiră: O singură cerere
    b.ctrl.editeaza(emp, { ci: '04:00' })
    const p04 = b.ctrl.salveaza(emp, ore(Z13, '04')); await asteapta()
    await b.raspunde('poarta', { ok: true, tichet: null }); await b.raspunde('uid', 'u1')
    const original = b.ale('scrie')[0]
    b.expira()
    expect(await p04).toMatchObject({ ok: false, necunoscut: true })
    expect(b.ale('scrie')).toHaveLength(1)
    // 2. recitirea (pornită după expirare): scrierea n-a ajuns încă → rândul se deblochează
    await b.raspunde('randuri', { data: [], error: null })
    expect(stareRand(b.s(), 1).necunoscut).toBe(false)
    // 3. utilizatorul salvează 06:00
    const p06 = b.ctrl.salveaza(emp, ore(Z13, '06')); await asteapta()
    await b.raspunde('poarta', { ok: true, tichet: null }); await b.raspunde('uid', 'u1')
    expect(b.ale('scrie')).toHaveLength(2)
    const r06 = rand(80, { ...ore(Z13, '06'), updated_at: 'v06' })
    await b.raspunde('scrie', { data: r06, error: null })
    expect((await p06).ok).toBe(true)
    expect(randulZilei(b.s(), 1)).toEqual(r06)
    // 4. răspunsul târziu al cererii ORIGINALE: pornește încă o recitire (observatorul urmărește cererea originală, nu o copie)
    const nRand = b.ale('randuri').length
    original.rezolva({ data: rand(80, { ...ore(Z13, '04') }), error: null }); await asteapta()
    expect(b.ale('randuri')).toHaveLength(nRand + 1)
    await b.raspunde('randuri', { data: [r06], error: null })
    for (let i = 0; i < 5; i++) { b.expira(); await asteapta() }
    // nicio a doua scriere 04:00 nu pleacă vreodată: exact două scrieri, 04:00 apoi 06:00
    expect(b.ale('scrie').map(x => x.args[0].check_in)).toEqual([`${Z13}T04:00:00Z`, `${Z13}T06:00:00Z`])
    expect(randulZilei(b.s(), 1)).toEqual(r06)
  })
})

describe('r5 (3) recitirea de FUNDAL eșuată pe un rând cu rezultat necunoscut se vede pe rând, cu „Reîncearcă”', () => {
  it('rezultat necunoscut + recitire eșuată: eroarea pe rând; reîncercarea arată „Reîncerc…”, apoi lămurește rândul', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp], { scrieImediat: false })
    await pornit(b)
    const p = b.ctrl.salveaza(emp, ore(Z13)); await asteapta()
    b.expira(); await p
    expect(stareRand(b.s(), 1)).toMatchObject({ necunoscut: true, recitireEsuata: null, reincerc: false })
    b.cereriR[1].rezolva({ data: null, error: { message: 'rețea căzută' } }); await asteapta()
    expect(b.s().randuri.stare).toBe('gata') // ultima citire reușită rămâne
    expect(stareRand(b.s(), 1)).toMatchObject({ necunoscut: true, recitireEsuata: 'rețea căzută', reincerc: false })
    const pR = b.ctrl.reincearca()
    expect(stareRand(b.s(), 1).reincerc).toBe(true)
    b.cereriR[2].rezolva({ data: null, error: { message: 'tot căzută' } })
    expect(await pR).toMatchObject({ fundalEroare: true })
    expect(stareRand(b.s(), 1)).toMatchObject({ necunoscut: true, recitireEsuata: 'tot căzută', reincerc: false })
    const pR2 = b.ctrl.reincearca()
    b.cereriR[3].rezolva({ data: [], error: null })
    expect(await pR2).toMatchObject({ fundalEroare: false })
    expect(stareRand(b.s(), 1)).toMatchObject({ necunoscut: false, recitireEsuata: null, reincerc: false })
  })
  it('fără rezultat necunoscut, o recitire de fundal eșuată nu schimbă rândurile și nu apare pe rând', async () => {
    const emp = { id: 1, site_id: 10 }
    const b = banc(Z13, [emp])
    const r05 = rand(9, { ...ore(Z13) })
    await pornit(b, { randuri: [r05] })
    b.ctrl.reimprospateaza(); b.cereriR[1].rezolva({ data: null, error: { message: 'x' } }); await asteapta()
    expect(randulZilei(b.s(), 1)).toBe(r05)
    expect(stareRand(b.s(), 1)).toMatchObject({ necunoscut: false, recitireEsuata: null })
  })
})

// ══ r5 (2) cererile, pe biblioteca REALĂ (supabase-js + postgrest-js instalate) cu `fetch` simulat ══
// Fiecare apel HTTP se înregistrează (metodă, cale, parametri, corp, antete); răspunsurile pot fi ținute în loc (amânate) de test.
function clientReal(raspuns = () => ({ body: [] })) {
  const http = []
  const fetchFals = async (url, init = {}) => {
    const u = new URL(String(url))
    const antete = Object.fromEntries([...new Headers(init.headers)].filter(([k]) => k !== 'x-client-info'))
    const c = { metoda: init.method || 'GET', cale: u.pathname, param: [...u.searchParams], corp: init.body ?? null, antete }
    http.push(c)
    const r = await raspuns(c)
    if (r.status === 204 || r.status === 201) return new Response(null, { status: r.status })
    return new Response(JSON.stringify(r.body), { status: r.status || 200, headers: { 'Content-Type': 'application/json' } })
  }
  const client = createClient('http://bd.test', 'cheie-anon-test', {
    global: { fetch: fetchFals, headers: { Authorization: 'Bearer jeton-test' } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return { client, http }
}
// răspunsurile serverului fals, după cerere
const serverPontaj = (randuri = []) => (c) => {
  if (c.cale === '/auth/v1/user') return { body: { id: 'u1', aud: 'authenticated' } }
  if (c.cale === '/rest/v1/rpc/fn_get_export_period_for_date') return { body: [] }
  if (c.cale === '/rest/v1/pontaj_records' && c.metoda === 'GET') return { body: c.param.some(([k, v]) => k === 'date' && v.startsWith('eq.')) ? randuri : [] }
  if (c.cale === '/rest/v1/pontaj_records' && c.metoda === 'POST') return { body: { id: 80, ...JSON.parse(c.corp) } }
  if (c.cale === '/rest/v1/tichete_istoric') return { status: 201 }
  if (c.cale === '/rest/v1/employees') return { status: 204 }
  throw new Error('cerere neașteptată: ' + c.metoda + ' ' + c.cale)
}
const asteaptaMult = async () => { for (let i = 0; i < 20; i++) await asteapta() }
const TERMEN = (zi) => `termen-${zi}`
// Dependențele din PAGINA r4 (src/App.jsx @ a48325eb), copiate LITERAL (doar `supabase` = clientul de test, `fmtZiPontaj(stareLuna(zi).termen)`
// = TERMEN(zi)): referința „octet cu octet” față de care se compară creeazaDependentePontaj.
const depR4 = (supabase) => ({
  citesteRanduri:(z,ids)=>supabase.from('pontaj_records').select('*').eq('date',z).in('employee_id',ids),
  citesteIstoric:(ids,z)=>incarcaUltimulSantier(supabase, ids, z),
  citesteExport:(z)=>supabase.rpc('fn_get_export_period_for_date', { p_date: z }),
  scrieRand:rand=>supabase.from('pontaj_records').upsert(rand,{onConflict:'employee_id,date'}).select().single(),
  uid:async()=>(await supabase.auth.getUser()).data.user?.id,
  noteaza:async({ tichet:t, emp, zi, campuri })=>{
    const uid = (await supabase.auth.getUser()).data.user?.id
    const { error } = await supabase.from('tichete_istoric').insert({
      tichet_id: t.id, actiune: 'corectura_pontaj', autor: uid || null,
      detalii: { employee_id: emp.id, angajat: emp.name, data: zi, campuri, termen: TERMEN(zi) },
    })
    return error ? `Corectura e salvată, dar nu s-a putut nota în ${t.numar_tichet}: ${error.message}` : null
  },
  scrieFisa:(empId,siteId)=>supabase.from('employees').update({site_id:siteId}).eq('id',empId),
})
const depR5 = (client, extra = {}) => creeazaDependentePontaj(client, { poarta: async () => ({ ok: true, tichet: null }), oreImplicite: () => ORE, termenCorectura: TERMEN, ...extra })

describe('r5 (2) creeazaDependentePontaj: aceleași cereri HTTP ca pagina r4, pe biblioteca reală', () => {
  const RAND = { created_by: 'u1', updated_by: 'u1', updated_at: 'T', check_in: `${Z13}T04:00:00Z`, check_out: null, norma: null, employee_id: 1, date: Z13, site_id: A }
  const cazuri = [
    ['citesteRanduri', [Z13, [1, 2]]], ['citesteIstoric', [[1, 2], Z13]], ['citesteExport', [Z13]], ['scrieRand', [RAND]], ['uid', []],
    ['noteaza', [{ tichet: { id: 7, numar_tichet: 'TKT-1' }, emp: { id: 1, name: 'POP ION' }, zi: Z13, campuri: ['site_id'] }]], ['scrieFisa', [1, B]],
  ]
  for (const [dep, args] of cazuri) {
    it(`${dep}: cererile r5 = cererile r4 (metodă, cale, parametri, corp, antete), același rezultat`, async () => {
      const v = clientReal(serverPontaj()), n = clientReal(serverPontaj())
      const rv = await depR4(v.client)[dep](...args)
      const rn = await depR5(n.client)[dep](...args)
      expect(n.http.length).toBeGreaterThan(0)
      expect(n.http).toEqual(v.http)
      expect(rn).toEqual(rv)
    })
  }
  it('valorile scrise de mână (din codul de dinainte): tabele, coloane, filtre, onConflict, apeluri', async () => {
    const { client, http } = clientReal(serverPontaj())
    const d = depR5(client)
    await d.citesteRanduri(Z13, [1, 2])
    await d.citesteIstoric([1, 2], Z13)
    await d.citesteExport(Z13)
    expect(await d.scrieRand(RAND)).toMatchObject({ data: { id: 80, site_id: A }, error: null })
    expect(await d.uid()).toBe('u1')
    expect(await d.noteaza({ tichet: { id: 7, numar_tichet: 'TKT-1' }, emp: { id: 1, name: 'POP ION' }, zi: Z13, campuri: ['site_id'] })).toBe(null)
    expect((await d.scrieFisa(1, B)).error).toBe(null)
    const pe = http.map(c => [c.metoda, c.cale, c.param, c.corp])
    expect(pe).toEqual([
      ['GET', '/rest/v1/pontaj_records', [['select', '*'], ['date', `eq.${Z13}`], ['employee_id', 'in.(1,2)']], null],
      ['GET', '/rest/v1/pontaj_records', [['select', 'id,employee_id,date,site_id,check_in,norma'], ['employee_id', 'in.(1,2)'], ['date', `lt.${Z13}`],
        ['site_id', 'not.is.null'], ['or', '(check_in.not.is.null,norma.is.null)'], ['order', 'date.desc,id.desc'], ['limit', '1000']], null],
      ['POST', '/rest/v1/rpc/fn_get_export_period_for_date', [], JSON.stringify({ p_date: Z13 })],
      ['POST', '/rest/v1/pontaj_records', [['on_conflict', 'employee_id,date'], ['select', '*']], JSON.stringify(RAND)],
      ['GET', '/auth/v1/user', [], null],
      ['GET', '/auth/v1/user', [], null],
      ['POST', '/rest/v1/tichete_istoric', [], JSON.stringify({ tichet_id: 7, actiune: 'corectura_pontaj', autor: 'u1', detalii: { employee_id: 1, angajat: 'POP ION', data: Z13, campuri: ['site_id'], termen: `termen-${Z13}` } })],
      ['PATCH', '/rest/v1/employees', [['id', 'eq.1']], JSON.stringify({ site_id: B })],
    ])
    // upsert: „merge-duplicates” + rândul întors, un singur obiect
    expect(http[3].antete.prefer).toMatch(/resolution=merge-duplicates/)
    expect(http[3].antete.prefer).toMatch(/return=representation/)
    expect(http[3].antete.accept).toBe('application/vnd.pgrst.object+json')
  })
})

describe('r5 (2) controlorul REAL cu dependențele REALE (supabase-js + fetch simulat)', () => {
  // timer manual pentru termene (ca în banc); `opreste` = cererile ținute în loc de test
  function bancReal({ randuri = [], opreste = () => false } = {}) {
    const tinute = []
    let tichet = null
    const srv = serverPontaj(randuri)
    const { client, http } = clientReal((c) => opreste(c) ? new Promise(res => tinute.push({ c, elibereaza: () => res(srv(c)) })) : srv(c))
    const timere = []
    const porti = []
    const ctrl = creeazaControlorZi({
      zi: Z13, ...depR5(client, { poarta: async (a) => { porti.push(a); return { ok: true, tichet } } }),
      timer: (ms, fn) => { const t = { fn, activ: true }; timere.push(t); return () => { t.activ = false } },
      acum: () => 'T',
    })
    return { ctrl, http, tinute, porti, s: () => ctrl.getStare(), cuTichet: (t) => { tichet = t }, expira: () => { for (const t of timere.splice(0)) if (t.activ) { t.activ = false; t.fn() } } }
  }
  const scrieri = (http) => http.filter(c => c.cale === '/rest/v1/pontaj_records' && c.metoda === 'POST')
  it('pornirea, salvarea și alocarea: câte cereri HTTP, cu ce conținut, în ce ordine', async () => {
    const emp = { id: 1, site_id: null, name: 'POP ION' }
    const b = bancReal()
    b.ctrl.seteazaAngajati([emp]); await asteaptaMult()
    expect(b.s()).toMatchObject({ randuri: { stare: 'gata' }, istoric: { stare: 'gata' }, exportZi: { stare: 'gata', exportat: false } })
    expect(b.http.map(c => c.metoda + ' ' + c.cale).sort()).toEqual(['GET /rest/v1/pontaj_records', 'GET /rest/v1/pontaj_records', 'POST /rest/v1/rpc/fn_get_export_period_for_date'])
    b.http.length = 0
    // salvare fără tichet (angajat nealocat: o absență, care nu cere șantier) = identitatea, apoi upsert-ul
    expect(await b.ctrl.salveaza(emp, { norma: 'CO', check_in: null, check_out: null, lunch_break: false, diurna: false, meal_supplement: false })).toMatchObject({ ok: true })
    expect(b.http.map(c => [c.metoda, c.cale])).toEqual([['GET', '/auth/v1/user'], ['POST', '/rest/v1/pontaj_records']])
    expect(JSON.parse(b.http[1].corp)).toEqual({ created_by: 'u1', updated_by: 'u1', updated_at: 'T', norma: 'CO', check_in: null, check_out: null, lunch_break: false, diurna: false, meal_supplement: false, employee_id: 1, date: Z13, site_id: null })
    expect(b.http[1].param).toEqual([['on_conflict', 'employee_id,date'], ['select', '*']])
    b.http.length = 0
    // alocare cu tichet, angajat fără fișă: identitate, scriere, (nota: identitate + insert), fișa
    b.cuTichet({ id: 7, numar_tichet: 'TKT-1' })
    expect(await b.ctrl.aloca(emp, B)).toMatchObject({ ok: true, notaEroare: null })
    await asteaptaMult()
    expect(b.http.map(c => [c.metoda, c.cale])).toEqual([['GET', '/auth/v1/user'], ['POST', '/rest/v1/pontaj_records'], ['GET', '/auth/v1/user'], ['POST', '/rest/v1/tichete_istoric'], ['PATCH', '/rest/v1/employees']])
    expect(JSON.parse(b.http[1].corp)).toEqual({ employee_id: 1, date: Z13, site_id: B, updated_by: 'u1', updated_at: 'T' })
    expect(JSON.parse(b.http[3].corp)).toMatchObject({ tichet_id: 7, actiune: 'corectura_pontaj', detalii: { employee_id: 1, data: Z13, campuri: ['site_id'] } })
    expect(b.http[4]).toMatchObject({ param: [['id', 'eq.1']], corp: JSON.stringify({ site_id: B }) })
    expect(b.porti).toHaveLength(2)
  })
  it('scenariul recenzentului pe biblioteca reală: 04:00 expiră → UN SINGUR POST; 06:00 salvat; răspunsul târziu nu mai trimite 04:00', async () => {
    const emp = { id: 1, site_id: 10 }
    let tine04 = true
    const b = bancReal({ opreste: (c) => tine04 && c.metoda === 'POST' && c.cale === '/rest/v1/pontaj_records' && c.corp.includes('T04:00') })
    b.ctrl.seteazaAngajati([emp]); await asteaptaMult()
    const p04 = b.ctrl.salveaza(emp, ore(Z13, '04')); await asteaptaMult()
    expect(scrieri(b.http)).toHaveLength(1)
    b.expira()
    expect(await p04).toMatchObject({ ok: false, necunoscut: true })
    await asteaptaMult()
    expect(scrieri(b.http)).toHaveLength(1)                       // r4: aici plecau DOUĂ cereri cu același conținut
    expect(stareRand(b.s(), 1).necunoscut).toBe(false)             // recitirea (pornită după expirare) a deblocat rândul
    tine04 = false
    expect(await b.ctrl.salveaza(emp, ore(Z13, '06'))).toMatchObject({ ok: true })
    const nGet = b.http.filter(c => c.metoda === 'GET' && c.cale === '/rest/v1/pontaj_records').length
    b.tinute[0].elibereaza(); await asteaptaMult()                // răspunsul târziu al cererii ORIGINALE
    expect(b.http.filter(c => c.metoda === 'GET' && c.cale === '/rest/v1/pontaj_records').length).toBe(nGet + 1) // încă o recitire
    expect(scrieri(b.http).map(c => JSON.parse(c.corp).check_in)).toEqual([`${Z13}T04:00:00Z`, `${Z13}T06:00:00Z`])
    expect(b.tinute).toHaveLength(1)
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
    for (const interzis of ['setRecs', 'useReducer', 'ziRef', 'dispatchZi', 'setEmps', 'setLoad', 'emps.filter(e=>!e.site_id)', 'loadRecs',
      // r4: nici „zi exportată”, nici editări, nici „se salvează” ca stare proprie a paginii
      'setIsDateExported', 'setExportPeriodInfo', 'requestPasswordIfExported', 'dirtyRef', 'markDirty', 'setSaving', 'noteazaCorectura'])
      expect(PAG).not.toContain(interzis)
  })
  it('r5: dependențele vin DOAR din creeazaDependentePontaj (testată mai sus cu biblioteca reală); pagina nu mai construiește nicio cerere a zilei', () => {
    const bloc = PAG.slice(PAG.indexOf('creeazaControlorZi('), PAG.indexOf('const ctrl=ctrlRef.current'))
    expect(bloc).toContain('...creeazaDependentePontaj(supabase, {')
    for (const ce of ["from('pontaj_records')", "rpc('fn_get_export_period_for_date'", "from('tichete_istoric')", "from('employees').update(", 'incarcaUltimulSantier(', 'auth.getUser'])
      expect(PAG).not.toContain(ce)
  })
  it('afișarea, filtrul, „Nealocate”, salvarea, alocarea, editările și reîncercarea trec prin controlor / instantaneul lui', () => {
    for (const f of ['propuneSantier(snap,emp)', 'nealocati(snap)', 'treceFiltrulSantier(', 'randulZilei(snap,emp.id)', 'arataSpinner(snap)',
      'valoriAfisate(snap,emp,', 'stareRand(snap,emp.id)', 'onEdit={ctrl.editeaza}', 'onRenunta={ctrl.renuntaEditare}', 'poarta:(a)=>poartaRef.current(a)',
      'ctrl.salveaza(emp, fields, { ctx: snap.ctx })', 'ctrl.aloca(emp, siteId, { ctx: snap.ctx })', 'ctrl.reincearca()', 'ctrl.reimprospateaza(', 'ctrl.seteazaZi(', 'ctrl.seteazaAngajati('])
      expect(PAG).toContain(f)
    // salvarea / alocarea: primul lucru e apelul controlorului (contextul de la apăsare), fără nicio așteptare înainte
    for (const fn of ['const saveRecord = async', 'const allocate = async']) {
      const i = PAG.indexOf(fn)
      const corp = PAG.slice(i, PAG.indexOf('\n  }', i))
      expect(corp.indexOf('await ')).toBe(corp.indexOf('await ctrl.'))
    }
  })
  it('PontajRow nu mai ține câmpurile ca stare locală resetată la fiecare rând nou (refresh-ul nu mai poate șterge ce ai tastat)', () => {
    const i = APP.indexOf('function PontajRow(')
    const ROW = APP.slice(i, APP.indexOf('\nfunction ', i + 10))
    for (const interzis of ['useState(rec', '},[rec])', 'setCi(', 'setCo(', 'setNorma(', 'setDiurna(', 'setSupl(', 'setMode(', 'onDirty'])
      expect(ROW).not.toContain(interzis)
    expect(ROW).toContain('const { ci, co, norma, diurna, supl, mode } = valori')
  })
})
