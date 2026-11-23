// TKT-0353 runda 5 (NO-GO Jakarinos r4 pe 493e9db6; decizia owner-ului 20.11.2026, varianta A): regula din BD — aceeași intrare
// (aceeași referinta_intentie, UNIQUE, migrarea 20261231a) nu se salvează de două ori. Clientul fals aplică regula ca migrarea
// (ON CONFLICT DO NOTHING sare rândul cu cheie existentă; INSERT simplu cu cheie existentă = 409 / 23505); `unic: false` = BD fără
// migrare. Valorile așteptate sunt scrise de mână (L25); eroarea de rețea are forma din postgrest-js (status 0).
// Proba pe PostgreSQL (PGlite, migrarea reală, rolul authenticated, mutanții indexului): scripts/pglite/test_magazie_intrare_referinta_local.mjs.
import { describe, it, expect } from 'vitest'
import {
  cheieIntentie, insereazaNoi, MESAJ_INSERARE_NECUNOSCUTA, MESAJ_REF_ALT, randNou, randuriDupaSalvare, salveazaFactura, UUID_VALID,
} from './magazieIntrareStoc.js'
import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const AZI = '2026-11-20'
const REF = '0a1b2c3d'
const CHEIE = '0a1b2c3d-0000-4000-8000-000000000000'
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0, statusText: '' }
const F1 = { nr: 'F1', data: AZI, furnizor: 'Furnizor SRL', categorie: 'scule' }
const rand5 = (v = {}) => ({ k: 1, denumire: 'Cheie dinamometrică', cantitate: '5', um: 'buc', pret: '', serie: '', ref: REF, cheie: CHEIE, tinta: 'nou', vazute: [], ...v })
const salv = (db, rows, extra = {}) => salveazaFactura(db, { rows, fact: F1, uid: 'u-1', azi: AZI, echipamente: [], catalogIds: new Set(), ...extra })
const ecran = (rows, res) => randuriDupaSalvare(rows, res, () => ({ k: 'gol', denumire: '' }))
const LINIE5 = `Intrare inițială 5 buc · Factura F1 din ${AZI} furnizor Furnizor SRL · ref ${REF}`
const confirmat = rows => rows.map(r => ({ ...r, retrimitereConfirmata: true }))

// Prima inserare rămâne „în zbor” (răspuns de rețea, rândul NU e încă în tabel); `ajunge()` o aplică mai târziu, cu regula BD-ului.
function dbCuInserareIntarziata(o = {}) {
  let inZbor = null
  const f = dbFals([], { ...o, laInsert: (t, p, ins) => { if (f.jurnal.insert.length === 1) { inZbor = () => ins(p); return RETEA } } })
  return { ...f, ajunge: () => inZbor() }
}

describe('r5: cheia intenției (UUID v4) și rândul trimis', () => {
  it('cheieIntentie: 16 octeți → UUID v4 (versiune 4, variantă RFC), litere mici; ref-ul ecranului = primele 8 cifre', () => {
    const o = Uint8Array.from({ length: 16 }, (_, i) => i * 17)
    expect(cheieIntentie(o)).toBe('00112233-4455-4677-8899-aabbccddeeff')
    expect(cheieIntentie(new Uint8Array(16).fill(255))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(UUID_VALID.test(cheieIntentie(new Uint8Array(16)))).toBe(true)
    expect(() => cheieIntentie(new Uint8Array(15))).toThrow()
    expect(() => cheieIntentie(null)).toThrow()
  })
  it('rândul nou poartă cheia în referinta_intentie (litere mici); inserarea = ON CONFLICT (referinta_intentie) DO NOTHING', async () => {
    expect(randNou(rand5({ cheie: CHEIE.toUpperCase() }), F1).payload.referinta_intentie).toBe(CHEIE)
    const { db, jurnal, tabel } = dbFals([])
    expect((await salv(db, [rand5()])).eroare).toBe(null)
    expect(jurnal.upsert).toEqual([{ onConflict: 'referinta_intentie', ignoreDuplicates: true }])
    expect(jurnal.insert[0]).toEqual([{ denumire: 'Cheie dinamometrică', categorie: 'scule', este_eip: false, um: 'buc', serie: null, cantitate_total: 5,
      stare: 'functional', observatii: LINIE5, referinta_intentie: CHEIE, created_by: 'u-1' }])
    expect(jurnal.recitiri).toBe(1)
    expect([...tabel.values()].map(e => [e.denumire, e.cantitate_total, e.referinta_intentie])).toEqual([['Cheie dinamometrică', 5, CHEIE]])
  })
  it('rând fără cheie / cheie invalidă / aceeași cheie de două ori în lot → refuz înaintea oricărei scrieri', async () => {
    for (const rows of [[rand5({ cheie: undefined })], [rand5({ cheie: 'x' })], [rand5(), rand5({ k: 2, denumire: 'Clește', ref: '99887766' })]]) {
      const { db, jurnal } = dbFals([])
      const r = await salv(db, rows)
      expect(r.eroare).toBe('Rândurile noi nu au referința intrării. Redeschide formularul. Nimic nu a fost scris.')
      expect(r.necunoscute).toEqual([])
      expect(jurnal.insert).toHaveLength(0)
    }
  })
})

describe('r5: verdictul r4 — retrimiterea confirmată + cererea inițială întârziată nu mai dublează', () => {
  it('cazul din verdict: 5 buc, „Failed to fetch”; omul confirmă, retrimiterea scrie; cererea inițială ajunge DUPĂ → tot UN rând de 5', async () => {
    const { db, tabel, jurnal, ajunge } = dbCuInserareIntarziata()
    const r1 = await salv(db, [rand5()])
    expect(r1.eroare).toBe(`${MESAJ_INSERARE_NECUNOSCUTA} (Rezultatul inserării nu poate fi confirmat (TypeError: Failed to fetch).)`)
    const rows = ecran([rand5()], r1)
    expect(tabel.size).toBe(0)
    const r2 = await salv(db, confirmat(rows))
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate).toEqual([1])
    expect(tabel.size).toBe(1)
    ajunge()
    expect(jurnal.insert).toHaveLength(2)
    expect(jurnal.insert[1]).toEqual(jurnal.insert[0])
    expect([...tabel.values()].map(e => [e.denumire, e.cantitate_total, e.observatii, e.referinta_intentie])).toEqual([['Cheie dinamometrică', 5, LINIE5, CHEIE]])
  })

  it('aceeași ordine FĂRĂ regula din BD (unic: false) dă două rânduri — dovada că închiderea vine din BD, nu din ecran', async () => {
    const { db, tabel, ajunge } = dbCuInserareIntarziata({ unic: false })
    const rows = ecran([rand5()], await salv(db, [rand5()]))
    expect((await salv(db, confirmat(rows))).aplicate).toEqual([1])
    ajunge()
    expect([...tabel.values()].map(e => e.cantitate_total)).toEqual([5, 5])
  })

  it('ordinea inversă: cererea inițială ajunge între recitirea listei și retrimitere → retrimiterea e sărită (ON CONFLICT), rândul recunoscut, un rând', async () => {
    let prima = null
    const f = dbFals([], { laInsert: (t, p, ins) => { const n = f.jurnal.insert.length; if (n === 1) { prima = p; return RETEA } if (n === 2) ins(prima) } })
    const rows = ecran([rand5()], await salv(f.db, [rand5()]))
    const r2 = await salv(f.db, confirmat(rows))
    expect(r2).toMatchObject({ eroare: null, aplicate: [1], necunoscute: [] })
    expect(f.tabel.size).toBe(1)
    expect(f.jurnal.insert).toHaveLength(2)
  })

  it('două rânduri în lot, unul deja ajuns din cererea anterioară: amândouă „salvate”, două rânduri în total (nu trei)', async () => {
    let prima = null
    const f = dbFals([], { laInsert: (t, p, ins) => { const n = f.jurnal.insert.length; if (n === 1) { prima = p; return RETEA } if (n === 2) ins([prima[0]]) } })
    const doua = [rand5(), rand5({ k: 2, denumire: 'Clește', cantitate: '2', ref: '99887766', cheie: '99887766-0000-4000-8000-000000000000' })]
    const rows = ecran(doua, await salv(f.db, doua))
    const r2 = await salv(f.db, confirmat(rows))
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate.sort()).toEqual([1, 2])
    expect([...f.tabel.values()].map(e => e.denumire).sort()).toEqual(['Cheie dinamometrică', 'Clește'])
  })

  it('plasa r4 rămâne: fără confirmare, rândul negăsit nu se retrimite (nimic scris)', async () => {
    const { db, jurnal } = dbCuInserareIntarziata()
    const rows = ecran([rand5()], await salv(db, [rand5()]))
    const r2 = await salv(db, rows)
    expect(r2.deConfirmat).toEqual([1])
    expect(jurnal.insert).toHaveLength(1)
  })
})

describe('r5: recitirea pe referință decide rezultatul (L04, L05)', () => {
  it('aceeași cheie în BD cu ALT conținut → refuz „alt conținut”, rândul existent neatins, formularul rămâne', async () => {
    const strain = { id: 9, ...randNou(rand5({ denumire: 'Cheie veche', cantitate: '6' }), F1).payload, observatii: 'scris de altcineva', activ: true }
    const { db, tabel, jurnal } = dbFals([strain])
    const r = await salv(db, [rand5()])
    expect(r.eroare).toBe(`„Cheie dinamometrică”: ${MESAJ_REF_ALT}`)
    expect(r.aplicate).toEqual([])
    expect(r.necunoscute).toEqual([])
    expect(jurnal.insert).toHaveLength(1)
    expect(tabel.size).toBe(1)
    expect(tabel.get(9)).toMatchObject({ denumire: 'Cheie veche', cantitate_total: 6, observatii: 'scris de altcineva' })
  })

  it('lot mixt: un rând nou salvat, unul cu cheia folosită de alt conținut → primul iese din formular, al doilea refuzat', async () => {
    const C2 = '99887766-0000-4000-8000-000000000000'
    const strain = { id: 9, ...randNou(rand5({ denumire: 'Altceva', ref: '99887766', cheie: C2 }), F1).payload, observatii: 'x', activ: true }
    const { db, tabel } = dbFals([strain])
    const r = await salv(db, [rand5(), rand5({ k: 2, denumire: 'Clește', cantitate: '2', ref: '99887766', cheie: C2 })])
    expect(r.aplicate).toEqual([1])
    expect(r.eroare).toBe(`„Clește”: ${MESAJ_REF_ALT}`)
    expect(tabel.size).toBe(2)
  })

  it('răspuns fără eroare, dar rândul nu apare la recitire → necunoscut (blocat), nu „salvat”', async () => {
    const { db } = dbFals([], { laInsert: () => ({ data: null, error: null, status: 201 }) })
    const r = await salv(db, [rand5()])
    expect(r.aplicate).toEqual([])
    expect(r.necunoscute.map(x => [x.k, x.fixat.inserare])).toEqual([[1, 'necunoscuta']])
    expect(r.eroare).toBe(`${MESAJ_INSERARE_NECUNOSCUTA} (Rezultatul inserării nu poate fi confirmat (rândul nu apare la recitire).)`)
  })

  it('recitirea eșuată → necunoscut; retrimiterea confirmată după ea nu creează al doilea rând', async () => {
    const { db, tabel } = dbFals([], { laRecitire: n => (n === 1 ? { data: null, error: { message: 'timeout' }, status: 504 } : null) })
    const r1 = await salv(db, [rand5()])
    expect(r1.aplicate).toEqual([])
    expect(r1.eroare).toBe(`${MESAJ_INSERARE_NECUNOSCUTA} (Inserarea a răspuns, dar rândurile nu au putut fi recitite (timeout). Retrimiterea aceleiași intrări nu creează al doilea rând.)`)
    expect(tabel.size).toBe(1)
    // lista din ecran (vederea, fără coloana cheii) îl arată deja: salvarea următoare îl recunoaște după ref + conținut, fără trimitere
    const rows = ecran([rand5()], r1)
    const r2 = await salv(db, confirmat(rows))
    expect(r2.aplicate).toEqual([1])
    expect(tabel.size).toBe(1)
  })

  it('insereazaNoi direct: refuz 4xx → eroare (nimic scris), fără recitire; stările pe rând în ordinea intențiilor', async () => {
    const { db, jurnal } = dbFals([], { laInsert: () => ({ data: null, error: { message: 'new row violates row-level security policy', code: '42501' }, status: 403 }) })
    expect(await insereazaNoi(db, [randNou(rand5(), F1)], 'u-1')).toEqual({ stare: 'eroare', mesaj: 'new row violates row-level security policy. Rândurile noi nu au fost scrise.' })
    expect(jurnal.recitiri).toBe(0)
    const d = dbFals([])
    const i2 = randNou(rand5({ ref: '99887766', cheie: '99887766-0000-4000-8000-000000000000', denumire: 'Clește' }), F1)
    expect(await insereazaNoi(d.db, [randNou(rand5(), F1), i2], 'u-1')).toEqual({ stare: 'ok', stari: ['ok', 'ok'] })
  })
})
