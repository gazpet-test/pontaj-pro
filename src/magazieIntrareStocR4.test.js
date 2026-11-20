// TKT-0353 runda 4 (NO-GO Jakarinos r3 pe 3d059fe7): după ORICE inserare cu rezultat necunoscut nu se mai reinserează
// automat. Scenariul din verdict (inserare întârziată + retrimitere) e testul negativ; căile legitime (L20): rândul ajuns
// e recunoscut, retrimiterea confirmată de om după verificare, refuzul 4xx, adunarea (UPDATE, apărată de CAS) neschimbată.
// Valorile așteptate sunt scrise de mână (L25); eroarea de rețea are forma din postgrest-js (status 0).
import { describe, it, expect } from 'vitest'
import {
  inserareNecunoscuta, linieIntrare, MESAJ_CERE_CONFIRMARE, MESAJ_INSERARE_NECUNOSCUTA, randNou, randuriDupaSalvare, salveazaFactura,
} from './magazieIntrareStoc.js'
import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const AZI = '2026-11-20'
const REF = '0a1b2c3d'
const REF2 = '99887766'
const RETEA = { data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' }, status: 0, statusText: '' }
const F1 = { nr: 'F1', data: AZI, furnizor: 'Furnizor SRL', categorie: 'scule' }
const rand5 = (v = {}) => ({ k: 1, denumire: 'Cheie dinamometrică', cantitate: '5', um: 'buc', pret: '', serie: '', ref: REF, tinta: 'nou', vazute: [], ...v })
const salv = (db, rows, extra = {}) => salveazaFactura(db, { rows, fact: F1, uid: 'u-1', azi: AZI, echipamente: [], catalogIds: new Set(), ...extra })
// ecranul după salvare: aceeași funcție ca modalul
const ecran = (rows, res) => randuriDupaSalvare(rows, res, () => ({ k: 'gol', denumire: '' }))
const LINIE5 = `Intrare inițială 5 buc · Factura F1 din ${AZI} furnizor Furnizor SRL · ref ${REF}`

// Inserarea inițială rămâne „în zbor”: răspunsul e eroare de rețea, rândul NU e încă în tabel; `ajunge()` o aplică mai târziu.
function dbCuInserareIntarziata(randuri = []) {
  let inZbor = null
  const f = dbFals(randuri, { laInsert: (t, p, ins) => { if (f.jurnal.insert.length === 1) { inZbor = () => ins(p); return RETEA } } })
  return { ...f, ajunge: () => inZbor() }
}

describe('r4: după o inserare cu rezultat necunoscut nu se reinserează automat', () => {
  it('mesajul din ecran și marcajul rândului', async () => {
    expect(MESAJ_INSERARE_NECUNOSCUTA).toBe('Nu se știe dacă intrarea s-a salvat — verifică lista (reîncărcată) înainte să trimiți din nou.')
    const { db } = dbCuInserareIntarziata()
    const r1 = await salv(db, [rand5()])
    expect(r1.eroare).toBe(`${MESAJ_INSERARE_NECUNOSCUTA} (Rezultatul inserării nu poate fi confirmat (TypeError: Failed to fetch).)`)
    expect(r1.aplicate).toEqual([])
    expect(r1.necunoscute).toHaveLength(1)
    expect(r1.necunoscute[0]).toMatchObject({ k: 1, fixat: { tinta: 'nou', inserare: 'necunoscuta', fact: F1, rand: { denumire: 'Cheie dinamometrică', cantitate: '5', ref: REF } } })
    expect(inserareNecunoscuta(ecran([rand5()], r1)[0])).toBe(true)
  })

  it('cazul din verdict: 5 buc, „Failed to fetch”, cererea întârziată; retrimiterea FĂRĂ confirmare nu inserează; cererea ajunge → UN singur rând de 5', async () => {
    const { db, tabel, jurnal, ajunge } = dbCuInserareIntarziata()
    const r1 = await salv(db, [rand5()])
    let rows = ecran([rand5()], r1)
    expect(tabel.size).toBe(0)
    // a doua apăsare pe „Salvează” cu lista încă goală: refuz, nimic scris
    const r2 = await salv(db, rows)
    expect(r2.eroare).toBe(`„Cheie dinamometrică”: ${MESAJ_CERE_CONFIRMARE}`)
    expect(r2.deConfirmat).toEqual([1])
    expect(r2.aplicate).toEqual([])
    expect(r2.necunoscute).toEqual([])
    expect(jurnal.insert).toHaveLength(1)
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.size).toBe(0)
    // cererea inițială ajunge
    ajunge()
    expect(tabel.size).toBe(1)
    // salvarea următoare (tot fără confirmare) recunoaște rândul după ref + conținut și nu mai trimite nimic
    const r3 = await salv(db, rows)
    expect(r3.eroare).toBe(null)
    expect(r3.aplicate).toEqual([1])
    expect(jurnal.insert).toHaveLength(1)
    rows = ecran(rows, r3)
    expect(rows).toEqual([{ k: 'gol', denumire: '' }])
    expect([...tabel.values()].map(e => [e.denumire, e.cantitate_total, e.observatii])).toEqual([['Cheie dinamometrică', 5, LINIE5]])
  })

  it('aceeași ordine cu mai multe apăsări fără confirmare: niciuna nu inserează', async () => {
    const { db, tabel, jurnal, ajunge } = dbCuInserareIntarziata()
    const rows = ecran([rand5()], await salv(db, [rand5()]))
    for (let i = 0; i < 3; i++) expect((await salv(db, rows)).deConfirmat).toEqual([1])
    ajunge()
    expect(jurnal.insert).toHaveLength(1)
    expect(tabel.size).toBe(1)
  })

  it('refuzul de confirmare oprește TOT lotul înaintea oricărei scrieri (și adunarea la un rând existent)', async () => {
    const tinta = { id: 7, denumire: 'Disc flex', categorie: 'scule', um: 'buc', cantitate_total: 29, observatii: null, activ: true }
    const { db, tabel, jurnal } = dbCuInserareIntarziata([tinta])
    const r1 = await salv(db, [rand5()], { echipamente: [tinta] })
    const rows = [...ecran([rand5()], r1), rand5({ k: 3, denumire: 'Disc flex', cantitate: '10', ref: REF2, tinta: 7, vazute: [7] })]
    const r2 = await salv(db, rows, { echipamente: [tinta] })
    expect(r2.deConfirmat).toEqual([1])
    expect(jurnal.update).toHaveLength(0)
    expect(jurnal.insert).toHaveLength(1)
    expect(tabel.get(7).cantitate_total).toBe(29)
  })

  it('calea legitimă: inserarea NU a ajuns, omul verifică lista și confirmă → o singură retrimitere, identică', async () => {
    const { db, tabel, jurnal } = dbFals([], { laInsert: () => (jurnal.insert.length === 1 ? RETEA : null) })
    const rows = ecran([rand5()], await salv(db, [rand5()]))
    expect(rows[0].retrimitereConfirmata).toBe(false)
    const r2 = await salv(db, [{ ...rows[0], retrimitereConfirmata: true }])
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate).toEqual([1])
    expect(jurnal.insert).toHaveLength(2)
    expect(jurnal.insert[1]).toEqual(jurnal.insert[0])
    expect(tabel.size).toBe(1)
  })

  it('confirmarea nu forțează inserarea: dacă rândul a ajuns între timp, e recunoscut („creat”), zero inserări noi', async () => {
    const { db, tabel, jurnal, ajunge } = dbCuInserareIntarziata()
    const rows = ecran([rand5()], await salv(db, [rand5()]))
    ajunge()
    const r2 = await salv(db, [{ ...rows[0], retrimitereConfirmata: true }])
    expect(r2.eroare).toBe(null)
    expect(r2.aplicate).toEqual([1])
    expect(jurnal.insert).toHaveLength(1)
    expect(tabel.size).toBe(1)
  })

  it('retrimiterea confirmată cu rezultat iar necunoscut → confirmarea se șterge, a treia trimitere cere o confirmare nouă', async () => {
    const { db, tabel, jurnal } = dbFals([], { laInsert: () => (jurnal.insert.length <= 2 ? RETEA : null) })
    let rows = ecran([rand5()], await salv(db, [rand5()]))
    const r2 = await salv(db, [{ ...rows[0], retrimitereConfirmata: true }])
    expect(r2.eroare).toMatch(/^Nu se știe dacă intrarea s-a salvat/)
    expect(r2.necunoscute[0].fixat).toMatchObject({ inserare: 'necunoscuta', tinta: 'nou' })
    rows = ecran([{ ...rows[0], retrimitereConfirmata: true }], r2)
    expect(rows[0].retrimitereConfirmata).toBe(false)
    expect((await salv(db, rows)).deConfirmat).toEqual([1])
    expect(jurnal.insert).toHaveLength(2)
    expect(tabel.size).toBe(0)
  })

  it('excepție la inserare (cererea poate fi plecată) = tot necunoscut, marcat, fără reinserare automată', async () => {
    const { db, jurnal } = dbFals([], { laInsert: () => { throw new Error('Failed to fetch') } })
    const r1 = await salv(db, [rand5()])
    expect(r1.necunoscute[0].fixat.inserare).toBe('necunoscuta')
    expect((await salv(db, ecran([rand5()], r1))).deConfirmat).toEqual([1])
    expect(jurnal.insert).toHaveLength(1)
  })

  it('calea legitimă: refuz 4xx la inserare → fără marcaj, rândul rămâne editabil și se poate trimite din nou fără confirmare', async () => {
    const { db, tabel, jurnal } = dbFals([], { laInsert: () => (jurnal.insert.length === 1 ? { data: null, error: { message: 'refuz', code: '42501' }, status: 403 } : null) })
    const r1 = await salv(db, [rand5()])
    expect(r1.necunoscute).toEqual([])
    const r2 = await salv(db, ecran([rand5()], r1))
    expect(r2.eroare).toBe(null)
    expect(tabel.size).toBe(1)
  })

  it('adunarea la un rând existent (UPDATE) cu rezultat necunoscut se retrimite în continuare identic, fără confirmare (CAS)', async () => {
    const tinta = { id: 7, denumire: 'Disc flex', categorie: 'scule', um: 'buc', cantitate_total: 29, observatii: null, activ: true }
    const { db, tabel, jurnal } = dbFals([tinta], { laUpdate: () => (jurnal.update.length === 1 ? RETEA : null) })
    const r = rand5({ k: 3, denumire: 'Disc flex', cantitate: '10', ref: REF2, tinta: 7, vazute: [7] })
    const r1 = await salv(db, [r], { echipamente: [tinta] })
    expect(r1.necunoscute[0].fixat.inserare).toBeUndefined()
    const rows = ecran([r], r1)
    const r2 = await salv(db, rows, { echipamente: [{ ...tinta }] })
    expect(r2.eroare).toBe(null)
    expect(r2.deConfirmat).toBeUndefined()
    expect(tabel.get(7).cantitate_total).toBe(39)
    expect(tabel.get(7).observatii).toBe(linieIntrare({ cantitate: 10, um: 'buc', facturaNr: 'F1', facturaData: AZI, furnizor: 'Furnizor SRL', dataIntrare: AZI, ref: REF2 }))
  })

  it('ref-ul găsit cu ALT conținut după o inserare necunoscută → refuz „alt conținut”, nu confirmare, nimic scris', async () => {
    const r = rand5()
    const { db, tabel, jurnal } = dbFals([{ id: 9, ...randNou({ ...r, cantitate: '6' }, F1).payload, activ: true }], { laInsert: () => RETEA })
    const blocat = { ...r, fixat: { tinta: 'nou', inserare: 'necunoscuta', rand: { ...r }, fact: { ...F1 } } }
    const res = await salv(db, [blocat])
    expect(res.eroare).toMatch(/alt conținut/)
    expect(res.deConfirmat).toBeUndefined()
    expect(jurnal.insert).toHaveLength(0)
    expect(tabel.get(9).cantitate_total).toBe(6)
  })
})

describe('r4: randuriDupaSalvare (ecranul după salvare)', () => {
  const gol = () => ({ k: 'gol', denumire: '' })
  it('rândurile aplicate ies, cele necunoscute primesc valorile trimise și confirmarea ștearsă, restul rămân neatinse', () => {
    const a = { k: 1, denumire: 'A' }, b = { k: 2, denumire: 'B', retrimitereConfirmata: true, fixat: { tinta: 'nou', inserare: 'necunoscuta' } }, c = { k: 3, denumire: 'C' }
    const fixatNou = { tinta: 'nou', inserare: 'necunoscuta', rand: { denumire: 'B' } }
    expect(randuriDupaSalvare([a, b, c], { aplicate: [1], necunoscute: [{ k: 2, fixat: fixatNou }] }, gol))
      .toEqual([{ k: 2, denumire: 'B', retrimitereConfirmata: false, fixat: fixatNou }, c])
  })
  it('toate aplicate → un rând gol; rezultat lipsă → rândurile rămân', () => {
    expect(randuriDupaSalvare([{ k: 1 }], { aplicate: [1] }, gol)).toEqual([gol()])
    expect(randuriDupaSalvare([{ k: 1 }], null, gol)).toEqual([{ k: 1 }])
  })
})
