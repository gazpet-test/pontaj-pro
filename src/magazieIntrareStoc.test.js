// TKT-0353: intrare peste stocul existent — logică pură + scrierea condiționată (client Supabase fals, cu filtrele aplicate ca în BD).
// Valorile așteptate sunt scrise de mână (sursă independentă de cod, L25).
import { describe, it, expect } from 'vitest'
import {
  adaugaLaObservatii, aplicaIntrare, cheieText, eroareCantitateIntrare, linieIntrare, motivFaraIntrare,
  potrivireExistente, refNou, sumaStoc, tintaRand, validareIntrare,
} from './magazieIntrareStoc.js'

import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const LINIE = 'Intrare +10 buc · 2026-11-20 · ref 0a1b2c3d'
const REF = '0a1b2c3d'

describe('sumaStoc: totalul nou = vechi + primit', () => {
  it('29 + 10 = 39', () => { expect(sumaStoc(29, '10')).toEqual({ ok: true, total: 39, text: '39' }) })
  it('virgula zecimală: 12,5 + 2,25 = 14,75', () => { expect(sumaStoc(12.5, '2,25').total).toBe(14.75) })
  it('exact pe zecimale: 0,1 + 0,2 = 0,3', () => { expect(sumaStoc(0.1, '0,2').total).toBe(0.3) })
  it('stoc gol: 0 + 7 = 7', () => { expect(sumaStoc(0, 7).total).toBe(7) })
  it('cantitate 0 / negativă / text → refuz', () => {
    for (const q of ['0', 0, '-5', -5, 'abc', '', '   ', null, undefined, '10 buc', '1e3', 'NaN', 'Infinity']) expect(sumaStoc(29, q).ok).toBe(false)
  })
  it('stoc curent invalid → refuz', () => {
    for (const v of [null, undefined, -1, NaN, 'x']) expect(sumaStoc(v, '10').ok).toBe(false)
  })
})

describe('eroareCantitateIntrare', () => {
  it('acceptă întregi și virgula zecimală', () => {
    for (const q of ['10', ' 10 ', '2,5', '0,5', 3]) expect(eroareCantitateIntrare(q)).toBe('')
  })
  it('refuză 0, negativ, text, două separatoare', () => {
    for (const q of ['0', '0,0', '-1', 'zece', '1,2,3', '1.2.3']) expect(eroareCantitateIntrare(q)).not.toBe('')
  })
  it('„1.000” e ambiguu (mie sau unu) → refuz cu mesaj despre virgulă', () => {
    expect(eroareCantitateIntrare('1.000')).toMatch(/ambigu/)
  })
})

describe('validareIntrare', () => {
  const azi = '2026-11-20'
  it('câmpurile opționale goale sunt acceptate', () => {
    expect(validareIntrare({ cantitate: '10' }, azi)).toEqual({ ok: true, cantitate: 10, facturaNr: '', facturaData: null, furnizor: '', pret: null })
  })
  it('prețul cu virgulă, textul pe un singur rând', () => {
    const v = validareIntrare({ cantitate: '10', pret: '25,50', facturaNr: ' FX\n12 ', furnizor: 'Firma  SRL', facturaData: '2026-11-19' }, azi)
    expect(v).toMatchObject({ ok: true, pret: 25.5, facturaNr: 'FX 12', furnizor: 'Firma SRL', facturaData: '2026-11-19' })
  })
  it('data facturii în viitor / inexistentă → refuz', () => {
    expect(validareIntrare({ cantitate: '1', facturaData: '2026-11-21' }, azi).ok).toBe(false)
    expect(validareIntrare({ cantitate: '1', facturaData: '2026-02-30' }, azi).ok).toBe(false)
  })
  it('preț negativ / text → refuz (nu se ignoră în tăcere)', () => {
    expect(validareIntrare({ cantitate: '1', pret: '-2' }, azi).ok).toBe(false)
    expect(validareIntrare({ cantitate: '1', pret: 'mult' }, azi).ok).toBe(false)
  })
  it('text peste limită → refuz, nu tăiere', () => {
    expect(validareIntrare({ cantitate: '1', facturaNr: 'x'.repeat(61) }, azi).ok).toBe(false)
  })
})

describe('linia de observații', () => {
  it('formatul complet', () => {
    expect(linieIntrare({ cantitate: 10, um: 'buc', facturaNr: 'FX 12', facturaData: '2026-11-19', furnizor: 'Firma SRL', pret: 25.5, dataIntrare: '2026-11-20', ref: REF }))
      .toBe('Intrare +10 buc · Factura FX 12 din 2026-11-19 · furnizor Firma SRL · preț unitar 25,5 lei · 2026-11-20 · ref 0a1b2c3d')
  })
  it('fără câmpurile opționale', () => {
    expect(linieIntrare({ cantitate: 2.5, um: 'pereche', dataIntrare: '2026-11-20', ref: REF })).toBe('Intrare +2,5 pereche · 2026-11-20 · ref 0a1b2c3d')
  })
  it('se adaugă după observațiile vechi, nu le înlocuiește', () => {
    expect(adaugaLaObservatii('Factura 1 din 2026-10-01 · preț unitar 20 lei', 'Intrare +10 buc')).toBe('Factura 1 din 2026-10-01 · preț unitar 20 lei\nIntrare +10 buc')
    expect(adaugaLaObservatii(null, 'Intrare +10 buc')).toBe('Intrare +10 buc')
    expect(adaugaLaObservatii('  ', 'Intrare +10 buc')).toBe('Intrare +10 buc')
  })
  it('refNou: 8 caractere hex din octeți', () => {
    expect(refNou(new Uint8Array([0, 171, 16, 255]))).toBe('00ab10ff')
    expect(() => refNou(new Uint8Array(2))).toThrow()
  })
})

describe('potrivirea denumirii (Adaugă din factură)', () => {
  const lista = [
    { id: 1, denumire: 'Cască protecție galbenă', categorie: 'eip', este_eip: true, um: 'buc', cantitate_total: 29, serie: null },
    { id: 2, denumire: 'Cască protecție galbenă', categorie: 'scule', um: 'buc', cantitate_total: 3, serie: null },
    { id: 3, denumire: 'Mănuși', categorie: 'eip', este_eip: true, um: 'pereche', cantitate_total: 50, serie: null },
    { id: 4, denumire: 'Bormașină', categorie: 'scule', um: 'buc', cantitate_total: 1, serie: 'INV-7' },
    { id: 5, denumire: 'Vestă', categorie: 'eip', este_eip: true, um: 'buc', cantitate_total: 4, activ: false },
  ]
  const fara = new Set()
  it('ignoră diacritice, majuscule și spațiile în plus (inclusiv ş/ţ cu sedilă)', () => {
    expect(cheieText('  CASCĂ  Protecţie   GALBENĂ ')).toBe('casca protectie galbena')
    expect(potrivireExistente({ denumire: 'CASCA PROTECTIE  galbena', um: 'BUC' }, 'eip', lista, fara).map(p => p.id)).toEqual([1])
  })
  it('nu leagă categorii diferite', () => {
    expect(potrivireExistente({ denumire: 'Cască protecție galbenă', um: 'buc' }, 'scule', lista, fara).map(p => p.id)).toEqual([2])
    expect(potrivireExistente({ denumire: 'Mănuși', um: 'pereche' }, 'scule', lista, fara)).toEqual([])
  })
  it('nu leagă UM diferite; UM goală = buc', () => {
    expect(potrivireExistente({ denumire: 'Manusi', um: 'buc' }, 'eip', lista, fara)).toEqual([])
    expect(potrivireExistente({ denumire: 'casca protectie galbena', um: '' }, 'eip', lista, fara).map(p => p.id)).toEqual([1])
  })
  it('nu leagă rânduri inactive sau cu serie (bucăți individuale)', () => {
    expect(potrivireExistente({ denumire: 'Vesta', um: 'buc' }, 'eip', lista, fara)).toEqual([])
    expect(potrivireExistente({ denumire: 'Bormasina', um: 'buc' }, 'scule', lista, fara)).toEqual([])
    expect(potrivireExistente({ denumire: 'Cască protecție galbenă', um: 'buc', serie: 'S1' }, 'eip', lista, fara)).toEqual([])
  })
  it('ținta implicită: o potrivire → adună la ea; mai multe → trebuie aleasă; niciuna → rând nou', () => {
    expect(tintaRand(undefined, [{ id: 1, motivBlocat: '' }])).toBe(1)
    expect(tintaRand(undefined, [{ id: 1, motivBlocat: '' }, { id: 9, motivBlocat: '' }])).toBe(null)
    expect(tintaRand(9, [{ id: 1, motivBlocat: '' }, { id: 9, motivBlocat: '' }])).toBe(9)
    expect(tintaRand(undefined, [])).toBe('nou')
    expect(tintaRand('nou', [{ id: 1, motivBlocat: '' }])).toBe('nou')
  })
  it('articol EIP din catalog: potrivirea e blocată, ținta implicită rămâne rând nou', () => {
    const p = potrivireExistente({ denumire: 'Mănuși', um: 'pereche' }, 'eip', lista, new Set([3]))
    expect(p[0].motivBlocat).toMatch(/Intrare EIP/)
    expect(tintaRand(undefined, p)).toBe('nou')
    expect(tintaRand(3, p)).toBe('nou')
  })
})

describe('motivFaraIntrare', () => {
  it('echipament obișnuit → permis; EIP fără catalog → permis', () => {
    expect(motivFaraIntrare({ id: 1, categorie: 'scule' }, new Set())).toBe('')
    expect(motivFaraIntrare({ id: 1, este_eip: true }, new Set())).toBe('')
  })
  it('EIP din catalog (articol_id sau v_eip_stoc) → blocat', () => {
    expect(motivFaraIntrare({ id: 1, este_eip: true, articol_id: 4 }, new Set())).not.toBe('')
    expect(motivFaraIntrare({ id: 1, este_eip: true }, new Set([1]))).not.toBe('')
  })
  it('catalog necunoscut (citire eșuată) → EIP blocat, restul permis', () => {
    expect(motivFaraIntrare({ id: 1, este_eip: true }, null)).not.toBe('')
    expect(motivFaraIntrare({ id: 1, categorie: 'scule' }, null)).toBe('')
  })
  it('inactiv → blocat', () => { expect(motivFaraIntrare({ id: 1, activ: false }, new Set())).not.toBe('') })
})

describe('aplicaIntrare: scrierea protejată la concurență', () => {
  const rand = () => ({ id: 7, cantitate_total: 29, observatii: 'Factura 1 din 2026-10-01', activ: true })
  const cerere = { id: 7, totalVazut: 29, primit: 10, linie: LINIE, ref: REF }

  it('caz normal: 29 + 10 = 39, observațiile vechi rămân, UPDATE condiționat pe total + observații + activ', async () => {
    const { db, tabel, jurnal } = dbFals([rand()])
    expect(await aplicaIntrare(db, cerere)).toEqual({ stare: 'ok', total: 39 })
    expect(tabel.get(7)).toMatchObject({ cantitate_total: 39, observatii: 'Factura 1 din 2026-10-01\n' + LINIE })
    expect(jurnal.update[0].filtre).toEqual([['eq', 'id', 7], ['eq', 'activ', true], ['eq', 'cantitate_total', 29], ['eq', 'observatii', 'Factura 1 din 2026-10-01']])
  })
  it('observații goale (NULL) → filtrul e „is null”', async () => {
    const { db, tabel, jurnal } = dbFals([{ ...rand(), observatii: null }])
    expect((await aplicaIntrare(db, cerere)).stare).toBe('ok')
    expect(tabel.get(7).observatii).toBe(LINIE)
    expect(jurnal.update[0].filtre).toContainEqual(['is', 'observatii', null])
  })
  it('totalul din ecran e vechi (altcineva a adăugat deja) → conflict, nimic scris', async () => {
    const { db, tabel, jurnal } = dbFals([{ ...rand(), cantitate_total: 35 }])
    expect((await aplicaIntrare(db, cerere)).stare).toBe('conflict')
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(35)
  })
  it('concurență: totalul se schimbă ÎNTRE citire și scriere (doar totalul) → 0 rânduri → conflict, fără reîncercare', async () => {
    const { db, tabel, jurnal } = dbFals([rand()], { dupaCitire: (t, n) => { if (n === 1) t.get(7).cantitate_total = 31 } })
    const r = await aplicaIntrare(db, cerere)
    expect(r.stare).toBe('conflict')
    expect(jurnal.update).toHaveLength(1)
    expect(tabel.get(7).cantitate_total).toBe(31)
    expect(tabel.get(7).observatii).toBe('Factura 1 din 2026-10-01')
  })
  it('concurență: observațiile se schimbă între citire și scriere → conflict, editarea celuilalt nu se pierde', async () => {
    const { db, tabel } = dbFals([rand()], { dupaCitire: (t, n) => { if (n === 1) t.get(7).observatii = 'editat de altcineva' } })
    expect((await aplicaIntrare(db, cerere)).stare).toBe('conflict')
    expect(tabel.get(7)).toMatchObject({ cantitate_total: 29, observatii: 'editat de altcineva' })
  })
  it('echipament scos din evidență între citire și scriere → nu scrie', async () => {
    const { db, tabel } = dbFals([rand()], { dupaCitire: (t, n) => { if (n === 1) t.get(7).activ = false } })
    expect((await aplicaIntrare(db, cerere)).stare).not.toBe('ok')
    expect(tabel.get(7).cantitate_total).toBe(29)
  })
  it('reîncercare după rezultat necunoscut: ref-ul e deja în observații → „deja”, nu se adună a doua oară', async () => {
    const { db, tabel, jurnal } = dbFals([{ ...rand(), cantitate_total: 39, observatii: 'Factura 1\n' + LINIE }])
    expect(await aplicaIntrare(db, cerere)).toEqual({ stare: 'deja', total: 39 })
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
  it('eroare de rețea după scriere reușită → se recitește și se confirmă prin ref („deja”)', async () => {
    const { db, tabel } = dbFals([rand()], {
      laUpdate: (t, q) => { Object.assign(t.get(7), q.valori); return { data: null, error: { message: 'Failed to fetch' } } },
    })
    expect((await aplicaIntrare(db, cerere)).stare).toBe('deja')
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
  it('UPDATE filtrat de drepturi (0 rânduri, nimic schimbat) → „refuzat”, nu conflict', async () => {
    const { db } = dbFals([rand()], { laUpdate: () => ({ data: [], error: null }) })
    expect((await aplicaIntrare(db, cerere)).stare).toBe('refuzat')
  })
  it('eroare la UPDATE fără efect → „eroare” cu mesajul, nu succes', async () => {
    // r3: refuzul cert vine de la server cu status 4xx (PostgREST: 42501 → 403); fără status ar fi „necunoscut” (vezi r3 P2)
    const { db, tabel } = dbFals([rand()], { laUpdate: () => ({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 }) })
    const r = await aplicaIntrare(db, cerere)
    expect(r.stare).toBe('eroare')
    expect(r.mesaj).toMatch(/permission denied/)
    expect(tabel.get(7).cantitate_total).toBe(29)
  })
  it('rezultat cu alt număr de rânduri decât 1 → nu e succes', async () => {
    const { db } = dbFals([rand()], { laUpdate: () => ({ data: [{ id: 7 }, { id: 7 }], error: null }) })
    expect((await aplicaIntrare(db, cerere)).stare).not.toBe('ok')
  })
  it('linia fără ref → refuz înainte de orice citire', async () => {
    const { db, jurnal } = dbFals([rand()])
    expect((await aplicaIntrare(db, { ...cerere, linie: 'Intrare +10 buc' })).stare).toBe('eroare')
    expect(jurnal.citiri).toBe(0)
  })
})
