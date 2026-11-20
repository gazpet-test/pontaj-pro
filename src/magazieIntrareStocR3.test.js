// TKT-0353 runda 3 (NO-GO Jakarinos r2 pe 3f7e3a53): un bloc pe fiecare punct din verdict, cu cazul reprodus de review
// și căile legitime (L20). Valorile așteptate sunt scrise de mână (L25); clientul e falsul cu filtre ca PostgREST, iar
// eroarea de rețea are forma din postgrest-js (error.message „TypeError: Failed to fetch”, status 0).
import { describe, it, expect } from 'vitest'
import {
  aplicaIntrare, aplicaLot, esecCert, insereazaNoi, intentieRand, judecaRandFactura, linieIntrare, MESAJ_REF_ALT,
  pregatesteIntrare, randNou, salveazaFactura,
} from './magazieIntrareStoc.js'
import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const AZI = '2026-11-20'
const REF = '0a1b2c3d'
const REF2 = '99887766'
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0, statusText: '' }
const F1 = { nr: 'F1', data: AZI, furnizor: 'Furnizor SRL', categorie: 'scule' }
const rand5 = (v = {}) => ({ k: 1, denumire: 'Cheie dinamometrică', cantitate: '5', um: 'buc', pret: '', serie: '', ref: REF, tinta: 'nou', vazute: [], ...v })
const salv = (db, rows, extra = {}) => salveazaFactura(db, { rows, fact: F1, uid: 'u-1', azi: AZI, echipamente: [], catalogIds: new Set(), ...extra })
// rândul creat de inserarea cu rezultat necunoscut (exact payload-ul trimis)
const creatDin = (r, fact = F1, id = 9) => ({ id, ...randNou(r, fact).payload, created_by: 'u-1', activ: true })

// ── P1: rândul nou recunoscut după ref ȘI conținut ──
describe('r3 P1: rândul din factură deja creat se recunoaște doar dacă are exact conținutul intenției', () => {
  it('payload-ul și linia: cantitatea inițială, factura, furnizorul, prețul și ref-ul stau în linie', () => {
    const { payload, linie } = randNou(rand5({ pret: '12,5' }), F1)
    expect(linie).toBe(`Intrare inițială 5 buc · Factura F1 din ${AZI} furnizor Furnizor SRL · preț unitar 12,5 lei · ref ${REF}`)
    expect(payload).toEqual({ denumire: 'Cheie dinamometrică', categorie: 'scule', este_eip: false, um: 'buc', serie: null, cantitate_total: 5, stare: 'functional', observatii: linie })
  })

  it('cazul din verdict: salvat cu 5 / F1, apoi formularul cu ACEEAȘI referință are 15 / F2 → eroare, nu „deja salvat”; zero scrieri, stocul rămâne 5', async () => {
    const { db, tabel, jurnal } = dbFals([creatDin(rand5())])
    const r = await salv(db, [rand5({ cantitate: '15' })], { fact: { ...F1, nr: 'F2' } })
    expect(r.aplicate).toEqual([])
    expect(r.necunoscute).toEqual([])
    expect(r.eroare).toBe(`„Cheie dinamometrică”: ${MESAJ_REF_ALT}`)
    expect(jurnal.insert).toHaveLength(0)
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(9).cantitate_total).toBe(5)
    expect(tabel.size).toBe(1)
  })

  it('fiecare câmp al intenției contează: cantitate, factură, dată, furnizor, preț, UM, denumire, serie, categorie → „alta”', () => {
    const lista = [creatDin(rand5())]
    const alta = (r, fact = F1) => judecaRandFactura(r, randNou(r, fact), lista).stare
    expect(alta(rand5({ cantitate: '15' }))).toBe('alta')
    expect(alta(rand5(), { ...F1, nr: 'F2' })).toBe('alta')
    expect(alta(rand5(), { ...F1, data: '2026-11-19' })).toBe('alta')
    expect(alta(rand5(), { ...F1, furnizor: 'Alt SRL' })).toBe('alta')
    expect(alta(rand5({ pret: '3' }))).toBe('alta')
    expect(alta(rand5({ um: 'set' }))).toBe('alta')
    expect(alta(rand5({ denumire: 'Cheie fixă' }))).toBe('alta')
    expect(alta(rand5({ serie: 'S-1' }))).toBe('alta')
    expect(alta(rand5(), { ...F1, categorie: 'eip' })).toBe('alta')
    // aceeași intenție → „creat”
    expect(alta(rand5())).toBe('creat')
  })

  it('rândul creat dezactivat, ref-ul pe două echipamente sau de două ori în același → „alta” (un om verifică), nu „creat”', () => {
    const r = rand5(), i = randNou(r, F1)
    expect(judecaRandFactura(r, i, [{ ...creatDin(r), activ: false }]).stare).toBe('alta')
    expect(judecaRandFactura(r, i, [creatDin(r), creatDin(r, F1, 10)]).stare).toBe('alta')
    expect(judecaRandFactura(r, i, [{ ...creatDin(r), observatii: `${i.linie}\n${i.linie}` }]).stare).toBe('alta')
  })

  it('calea legitimă: intrare ulterioară pe rândul creat (+3, alt ref) nu-l face de nerecunoscut — cantitatea inițială e în linie', () => {
    const r = rand5(), i = randNou(r, F1)
    const dupa = { ...creatDin(r), cantitate_total: 8, observatii: `${i.linie}\n${linieIntrare({ cantitate: 3, um: 'buc', dataIntrare: AZI, ref: REF2 })}` }
    expect(judecaRandFactura(r, i, [dupa])).toMatchObject({ stare: 'creat', echip: { id: 9 } })
  })

  it('rând cu țintă existentă: ref-ul doar pe țintă → „tinta” (judecă aplicaIntrare); ref-ul pe ALT echipament → „alta”, nimic scris', async () => {
    const tinta = { id: 7, denumire: 'Cheie dinamometrică', categorie: 'scule', um: 'buc', cantitate_total: 29, observatii: null, activ: true }
    const r = rand5({ tinta: 7 })
    expect(judecaRandFactura(r, intentieRand(r, F1), [tinta])).toEqual({ stare: 'absent' })
    const peTinta = { ...tinta, observatii: linieIntrare({ cantitate: 5, um: 'buc', facturaNr: 'F1', facturaData: AZI, furnizor: 'Furnizor SRL', dataIntrare: AZI, ref: REF }) }
    expect(judecaRandFactura(r, intentieRand(r, F1), [peTinta])).toEqual({ stare: 'tinta' })
    const altul = { id: 12, denumire: 'Altceva', categorie: 'scule', um: 'buc', cantitate_total: 1, observatii: `x · ref ${REF}`, activ: true }
    expect(judecaRandFactura(r, intentieRand(r, F1), [tinta, altul]).stare).toBe('alta')
    const { db, tabel, jurnal } = dbFals([tinta, altul])
    const res = await salv(db, [r], { echipamente: [tinta, altul] })
    expect(res.eroare).toMatch(/alt conținut/)
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(29)
  })

  it('calea legitimă completă: 2 rânduri noi + 1 adunare → scrise; retrimiterea IDENTICĂ (răspuns pierdut) → toate recunoscute, zero scrieri noi', async () => {
    const tinta = { id: 7, denumire: 'Disc flex', categorie: 'scule', um: 'buc', cantitate_total: 29, observatii: null, activ: true }
    const rows = [rand5(), rand5({ k: 2, denumire: 'Clește', cantitate: '2', ref: REF2 }), rand5({ k: 3, denumire: 'Disc flex', cantitate: '10', ref: '11112222', tinta: 7, vazute: [7] })]
    const { db, tabel, jurnal } = dbFals([tinta])
    const r1 = await salv(db, rows, { echipamente: [tinta] })
    expect(r1).toMatchObject({ eroare: null, laStoc: 1, noi: 2 })
    expect(r1.aplicate.sort()).toEqual([1, 2, 3])
    expect(tabel.get(7).cantitate_total).toBe(39)
    expect([...tabel.values()].map(e => e.cantitate_total).sort((a, b) => a - b)).toEqual([2, 5, 39])
    // a doua trimitere a acelorași rânduri (lista din ecran reîncărcată după prima)
    const r2 = await salv(db, rows, { echipamente: [...tabel.values()] })
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate.sort()).toEqual([1, 2, 3])
    expect(jurnal.insert).toHaveLength(1)
    expect(jurnal.update).toHaveLength(1)
    expect(tabel.size).toBe(3)
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
})

// ── P2: eroarea de rețea nu e „nimic nu a fost scris” ──
describe('r3 P2: o eroare fără refuz 4xx (rețea, 5xx, 408) e NECUNOSCUT, nu eșec cert', () => {
  const rand = () => ({ id: 7, cantitate_total: 29, observatii: 'Factura 1', activ: true })
  const L10 = linieIntrare({ cantitate: 10, um: 'buc', dataIntrare: AZI, ref: REF })
  const cerere = { id: 7, totalVazut: 29, primit: 10, linie: L10, ref: REF }

  it('esecCert: doar 4xx (fără 408) e refuz cert; status 0 / lipsă / 5xx / fără eroare nu', () => {
    for (const s of [400, 401, 403, 404, 409, 422, 499]) expect(esecCert({ error: { message: 'x' }, status: s })).toBe(true)
    for (const s of [0, 408, 500, 502, 503, 504, undefined, null, '403', 403.5]) expect(esecCert({ error: { message: 'x' }, status: s })).toBe(false)
    expect(esecCert({ error: null, status: 403 })).toBe(false)
    expect(esecCert(RETEA)).toBe(false)
  })

  it('cazul din verdict: „Failed to fetch”, recitirea vede 29 → NECUNOSCUT (nu „eroare”); commit-ul întârziat duce la 39; retrimiterea identică → „deja”, 39 (nu 49)', async () => {
    let cerereaInitiala = null
    const { db, tabel, jurnal } = dbFals([rand()], {
      laUpdate: (t, q) => { if (jurnal.update.length === 1) { cerereaInitiala = q; return RETEA } },
    })
    const r1 = await aplicaIntrare(db, cerere)
    expect(r1.stare).toBe('necunoscut')
    expect(r1.mesaj).not.toMatch(/Nimic nu a fost scris/)
    expect(tabel.get(7).cantitate_total).toBe(29)
    // cererea inițială ajunge totuși (commit întârziat): aceleași valori și filtre CAS
    const vechi = tabel.get(7)
    expect(cerereaInitiala.filtre).toEqual([['eq', 'id', 7], ['eq', 'activ', true], ['eq', 'cantitate_total', 29], ['eq', 'observatii', 'Factura 1']])
    Object.assign(vechi, cerereaInitiala.valori)
    expect(tabel.get(7).cantitate_total).toBe(39)
    const r2 = await aplicaIntrare(db, cerere)
    expect(r2).toEqual({ stare: 'deja', total: 39 })
    expect(tabel.get(7).cantitate_total).toBe(39)
    expect(jurnal.update).toHaveLength(1)
  })

  it('ordinea inversă: retrimiterea identică scrie (39), apoi cererea inițială întârziată ajunge → filtrul CAS nu mai potrivește, rămâne 39', async () => {
    let initiala = null
    const { db, tabel, jurnal } = dbFals([rand()], { laUpdate: (t, q) => { if (jurnal.update.length === 1) { initiala = q; return RETEA } } })
    expect((await aplicaIntrare(db, cerere)).stare).toBe('necunoscut')
    expect(await aplicaIntrare(db, cerere)).toEqual({ stare: 'ok', total: 39 })
    // cererea inițială ajunge acum: aceleași filtre (total 29, observații vechi) nu mai găsesc rândul
    const r = tabel.get(7)
    const potriveste = initiala.filtre.every(([, c, v]) => r[c] === v)
    expect(potriveste).toBe(false)
    expect(r.cantitate_total).toBe(39)
  })

  it('5xx, 408, eroare fără status, răspuns fără listă → necunoscut; recitirea eșuată → necunoscut', async () => {
    for (const raspuns of [
      { data: null, error: { message: 'Bad gateway' }, status: 502 },
      { data: null, error: { message: 'timeout' }, status: 408 },
      { data: null, error: { message: 'ceva' } },
      { data: null, error: null, status: 200 },
    ]) {
      const { db, tabel } = dbFals([rand()], { laUpdate: () => raspuns })
      expect((await aplicaIntrare(db, cerere)).stare).toBe('necunoscut')
      expect(tabel.get(7).cantitate_total).toBe(29)
    }
  })

  it('calea legitimă: refuz 4xx (403 / 42501, 409, 400) → „eroare” cu „Nimic nu a fost scris” (formularul rămâne editabil)', async () => {
    for (const [status, code] of [[403, '42501'], [409, '23505'], [400, '22P02']]) {
      const { db, tabel } = dbFals([rand()], { laUpdate: () => ({ data: null, error: { message: 'refuz', code }, status }) })
      const r = await aplicaIntrare(db, cerere)
      expect(r).toEqual({ stare: 'eroare', mesaj: 'refuz. Nimic nu a fost scris.' })
      expect(tabel.get(7).cantitate_total).toBe(29)
    }
  })

  it('calea legitimă: 0 rânduri fără eroare (filtrat de drepturi) rămâne „refuzat”; schimbare concurentă rămâne „conflict”', async () => {
    const a = dbFals([rand()], { laUpdate: () => ({ data: [], error: null, status: 200 }) })
    expect((await aplicaIntrare(a.db, cerere)).stare).toBe('refuzat')
    const b = dbFals([rand()], { laUpdate: t => { t.get(7).cantitate_total = 31; return { data: [], error: null, status: 200 } } })
    expect((await aplicaIntrare(b.db, cerere)).stare).toBe('conflict')
  })

  it('în lotul din factură, rândul cu eroare de rețea oprește lotul ca „necunoscut” (și se blochează la salvare)', async () => {
    const pas = { k: 'a', id: 7, totalVazut: 29, primit: 10, linie: L10, ref: REF }
    const { db } = dbFals([rand()], { laUpdate: () => RETEA })
    expect((await aplicaLot(db, [pas])).oprit).toMatchObject({ k: 'a', stare: 'necunoscut' })
    const tinta = { ...rand(), denumire: 'Disc', categorie: 'scule', um: 'buc' }
    const d = dbFals([tinta], { laUpdate: () => RETEA })
    const res = await salv(d.db, [rand5({ k: 4, denumire: 'Disc', cantitate: '10', tinta: 7, vazute: [7] })], { echipamente: [tinta] })
    expect(res.aplicate).toEqual([])
    expect(res.necunoscute).toEqual([{ k: 4, fixat: { azi: AZI, tinta: 7, form: { cantitate: '10', facturaNr: 'F1', facturaData: AZI, furnizor: 'Furnizor SRL', pret: '' } } }])
  })

  it('insereazaNoi: 201 → ok; 4xx → eroare; status 0, 5xx, excepție → necunoscut', async () => {
    expect(await insereazaNoi(dbFals([]).db, [{ denumire: 'x' }])).toEqual({ stare: 'ok' })
    expect((await insereazaNoi(dbFals([], { laInsert: () => ({ data: null, error: { message: 'denied', code: '42501' }, status: 403 }) }).db, [{}])).stare).toBe('eroare')
    expect((await insereazaNoi(dbFals([], { laInsert: () => RETEA }).db, [{}])).stare).toBe('necunoscut')
    expect((await insereazaNoi(dbFals([], { laInsert: () => ({ data: null, error: { message: 'x' }, status: 503 }) }).db, [{}])).stare).toBe('necunoscut')
    expect((await insereazaNoi(dbFals([], { laInsert: () => { throw new Error('Failed to fetch') } }).db, [{}])).stare).toBe('necunoscut')
  })

  it('inserarea ajunge, răspunsul e eroare de rețea → rândurile se blochează pe valori + antet; reîncercarea (antetul din ecran schimbat între timp) le recunoaște, o singură inserare', async () => {
    const { db, tabel, jurnal } = dbFals([], { laInsert: (t, p, ins) => { if (jurnal.insert.length === 1) { ins(p); return RETEA } } })
    const rows = [rand5(), rand5({ k: 2, denumire: 'Clește', cantitate: '2', ref: REF2 })]
    const r1 = await salv(db, rows)
    expect(r1.aplicate).toEqual([])
    expect(r1.eroare).toMatch(/nu poate fi confirmat/)
    expect(r1.necunoscute.map(x => x.k)).toEqual([1, 2])
    expect(r1.necunoscute[0].fixat).toMatchObject({ tinta: 'nou', fact: F1, rand: { denumire: 'Cheie dinamometrică', cantitate: '5', ref: REF } })
    expect(tabel.size).toBe(2)
    // ecranul: rândurile blocate; omul a schimbat între timp numărul facturii din antet (nu afectează rândurile blocate)
    const blocate = rows.map(r => ({ ...r, fixat: r1.necunoscute.find(x => x.k === r.k).fixat }))
    const r2 = await salv(db, blocate, { fact: { ...F1, nr: 'F2' } })
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate.sort()).toEqual([1, 2])
    expect(jurnal.insert).toHaveLength(1)
    expect(tabel.size).toBe(2)
  })

  it('inserarea refuzată 4xx → rândurile NU se blochează (nimic scris, se pot corecta)', async () => {
    const { db, tabel } = dbFals([], { laInsert: () => ({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 }) })
    const r = await salv(db, [rand5()])
    expect(r.necunoscute).toEqual([])
    expect(r.eroare).toMatch(/nu au fost scrise/)
    expect(tabel.size).toBe(0)
  })

  it('inserarea NU a ajuns (rețea): reîncercarea blocată NU se trimite singură (r4); cu confirmarea omului se trimite o dată, identic', async () => {
    const { db, tabel, jurnal } = dbFals([], { laInsert: () => (jurnal.insert.length === 1 ? RETEA : null) })
    const r1 = await salv(db, [rand5()])
    const r2a = await salv(db, [{ ...rand5(), fixat: r1.necunoscute[0].fixat }])
    expect(r2a.deConfirmat).toEqual([1])
    expect(jurnal.insert).toHaveLength(1)
    const r2 = await salv(db, [{ ...rand5(), fixat: r1.necunoscute[0].fixat, retrimitereConfirmata: true }])
    expect(r2.eroare).toBe(null)
    expect(jurnal.insert).toHaveLength(2)
    expect(jurnal.insert[1]).toEqual(jurnal.insert[0])
    expect(tabel.size).toBe(1)
  })

  it('pregatesteIntrare + aplicaIntrare: refuzul înainte de scriere (ref invalid) rămâne eroare certă, fără citiri', async () => {
    const { db, jurnal } = dbFals([rand()])
    const p = pregatesteIntrare({ um: 'buc', form: { cantitate: '10' }, azi: AZI, ref: REF })
    expect((await aplicaIntrare(db, { ...cerere, linie: p.linie, ref: 'zz' })).stare).toBe('eroare')
    expect(jurnal.citiri).toBe(0)
  })
})
