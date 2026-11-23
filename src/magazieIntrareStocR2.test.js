// TKT-0353 runda 2 (NO-GO Jakarinos pe 36c24a18): un bloc pe fiecare punct din verdict, cu cazul care pica înainte
// și cazurile legitime (L20). Valorile așteptate sunt scrise de mână (L25); clientul e falsul cu filtre ca PostgREST.
import { describe, it, expect } from 'vitest'
import {
  aplicaIntrare, aplicaLot, citesteEchipamente, dubluriNevazute, eroareCantitateIntrare, judecaRandFactura, linieIntrare, MESAJ_REF_ALT,
  potrivireExistente, pregatesteIntrare, randNou, stareRef, sumaStoc, validareIntrare,
} from './magazieIntrareStoc.js'
import { dbFals } from './magazieIntrareStocDbFals.testutil.js'

const AZI = '2026-11-20'
const REF = '0a1b2c3d'
const REF2 = '99887766'

// ── P1: verificarea dublurilor pe lista COMPLETĂ ──
describe('r2 P1: lista completă de echipamente (keyset) și verificarea dublurilor înaintea inserării', () => {
  const multe = n => Array.from({ length: n }, (_, i) => ({ id: i + 1, denumire: `Articol ${String(i + 1).padStart(4, '0')}`, categorie: 'scule', um: 'buc', cantitate_total: 1, activ: true }))

  it('2.500 de rânduri, plafon de server 1.000 → toate 2.500, pe pagini până la pagina goală', async () => {
    const { db, jurnal } = dbFals(multe(2500), { maxRows: 1000 })
    const toate = await citesteEchipamente(db)
    expect(toate).toHaveLength(2500)
    expect(new Set(toate.map(e => e.id)).size).toBe(2500)
    expect(jurnal.liste).toBe(4) // 1000 + 1000 + 500 + pagina goală
  })
  it('plafonul serverului MAI MIC decât pasul cerut (pagini de 1000 cerute, server dă 300) → tot complet', async () => {
    const { db } = dbFals(multe(1100), { maxRows: 300 })
    expect(await citesteEchipamente(db)).toHaveLength(1100)
  })
  it('ordonare după denumire (românește), apoi după id', async () => {
    const { db } = dbFals([
      { id: 3, denumire: 'Ţeavă', categorie: 'scule' }, { id: 1, denumire: 'Bormașină', categorie: 'scule' },
      { id: 2, denumire: 'Ancoră', categorie: 'scule' }, { id: 4, denumire: 'Bormașină', categorie: 'scule' },
    ])
    expect((await citesteEchipamente(db)).map(e => e.id)).toEqual([2, 1, 4, 3])
  })
  it('eroare pe pagina a doua → aruncă (nu întoarce o listă parțială ca și cum ar fi completă)', async () => {
    const { db } = dbFals(multe(2500), { laLista: n => (n === 2 ? { data: null, error: { message: 'timeout' } } : null) })
    await expect(citesteEchipamente(db)).rejects.toMatchObject({ message: 'timeout' })
  })
  it('listă goală = zero rânduri (nu eroare)', async () => {
    const { db } = dbFals([])
    expect(await citesteEchipamente(db)).toEqual([])
  })

  it('cazul din verdict: echipamentul existent e al 1.500-lea → lista veche (trunchiată) nu-l vede, verificarea pe lista completă îl prinde', async () => {
    const lista = multe(2000)
    lista[1499] = { ...lista[1499], denumire: 'Cască protecție', categorie: 'eip', um: 'buc' }
    const rand = { k: 1, denumire: 'CASCA PROTECTIE', um: 'buc', tinta: 'nou', vazute: [] }
    // ce vedea ecranul înainte (select fără paginare, plafon 1000): nicio potrivire → inserare implicită = dublură
    expect(potrivireExistente(rand, 'eip', lista.slice(0, 1000), new Set())).toEqual([])
    const { db } = dbFals(lista)
    const dub = dubluriNevazute([rand], 'eip', await citesteEchipamente(db))
    expect(dub).toEqual([{ k: 1, denumire: 'CASCA PROTECTIE', ids: [1500] }])
  })
  it('potrivire VĂZUTĂ de om și aleasă explicit „rând nou separat” → nu e refuzată', () => {
    const lista = [{ id: 5, denumire: 'Cască', categorie: 'eip', um: 'buc', activ: true }]
    expect(dubluriNevazute([{ k: 1, denumire: 'Cască', um: 'buc', tinta: 'nou', vazute: [5] }], 'eip', lista)).toEqual([])
  })
  it('rând apărut între timp (al doilea „Cască”, nevăzut) → refuz chiar dacă primul a fost văzut', () => {
    const lista = [{ id: 5, denumire: 'Cască', categorie: 'eip', um: 'buc' }, { id: 6, denumire: 'casca', categorie: 'eip', um: 'BUC' }]
    expect(dubluriNevazute([{ k: 1, denumire: 'Cască', um: 'buc', tinta: 'nou', vazute: [5] }], 'eip', lista)).toEqual([{ k: 1, denumire: 'Cască', ids: [6] }])
  })
  it('rândurile cu țintă existentă, altă categorie / UM / serie → nu sunt dubluri de refuzat', () => {
    const lista = [{ id: 5, denumire: 'Cască', categorie: 'eip', um: 'buc' }]
    expect(dubluriNevazute([
      { k: 1, denumire: 'Cască', um: 'buc', tinta: 5, vazute: [] },
      { k: 2, denumire: 'Cască', um: 'buc', tinta: 'nou', vazute: [] , serie: 'S-1' },
      { k: 3, denumire: 'Cască', um: 'pereche', tinta: 'nou', vazute: [] },
    ], 'eip', lista)).toEqual([])
    expect(dubluriNevazute([{ k: 1, denumire: 'Cască', um: 'buc', tinta: 'nou', vazute: [] }], 'scule', lista)).toEqual([])
  })
  it('id-uri comparate ca text (bigint venit ca număr sau text) → aceeași potrivire văzută', () => {
    const lista = [{ id: 5, denumire: 'Cască', categorie: 'eip', um: 'buc' }]
    expect(dubluriNevazute([{ k: 1, denumire: 'Cască', um: 'buc', tinta: 'nou', vazute: ['5'] }], 'eip', lista)).toEqual([])
  })
})

// ── P2: mai multe rânduri din factură pe ACELAȘI echipament ──
describe('r2 P2: rânduri bulk pe același echipament se înlănțuie, nu intră în conflict între ele', () => {
  const pas = (k, id, totalVazut, cant, ref) => ({ k, id, totalVazut, primit: cant, ref, linie: linieIntrare({ cantitate: cant, um: 'buc', dataIntrare: AZI, ref }) })

  it('cazul din verdict: stoc 29, +10 și +5 → 39 apoi 44, ambele salvate, fără conflict', async () => {
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }])
    const r = await aplicaLot(db, [pas('a', 7, 29, 10, REF), pas('b', 7, 29, 5, REF2)])
    expect(r).toEqual({ aplicate: ['a', 'b'], oprit: null })
    expect(tabel.get(7).cantitate_total).toBe(44)
    expect(tabel.get(7).observatii).toBe(`Intrare +10 buc · ${AZI} · ref ${REF}\nIntrare +5 buc · ${AZI} · ref ${REF2}`)
  })
  it('echipamente diferite în același lot: fiecare cu baza lui', async () => {
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }, { id: 8, cantitate_total: 2, observatii: 'x', activ: true }])
    const r = await aplicaLot(db, [pas('a', 7, 29, 10, REF), pas('c', 8, 2, 1, '11111111'), pas('b', 7, 29, 5, REF2)])
    expect(r.aplicate).toEqual(['a', 'c', 'b'])
    expect(tabel.get(7).cantitate_total).toBe(44)
    expect(tabel.get(8).cantitate_total).toBe(3)
  })
  it('concurență REALĂ între cele două rânduri (altcineva schimbă totalul) → al doilea e conflict, primul rămâne aplicat', async () => {
    // citirea 1 = rândul a; după citirea 2 (rândul b) altcineva pune 50
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }], { dupaCitire: (t, n) => { if (n === 2) t.get(7).cantitate_total = 50 } })
    const r = await aplicaLot(db, [pas('a', 7, 29, 10, REF), pas('b', 7, 29, 5, REF2)])
    expect(r.aplicate).toEqual(['a'])
    expect(r.oprit).toMatchObject({ k: 'b', stare: 'conflict' })
    expect(tabel.get(7).cantitate_total).toBe(50)
  })
  it('totalul din ecran vechi chiar la primul rând → conflict, nimic scris', async () => {
    const { db, tabel, jurnal } = dbFals([{ id: 7, cantitate_total: 35, observatii: null, activ: true }])
    const r = await aplicaLot(db, [pas('a', 7, 29, 10, REF), pas('b', 7, 29, 5, REF2)])
    expect(r).toEqual({ aplicate: [], oprit: { k: 'a', stare: 'conflict', total: 35 } })
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(35)
  })
  it('reluare după o încercare cu rezultat necunoscut: rândul a era deja scris (lista reîncărcată = 39) → a „deja”, b se adună → 44', async () => {
    const linieA = linieIntrare({ cantitate: 10, um: 'buc', dataIntrare: AZI, ref: REF })
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 39, observatii: linieA, activ: true }])
    const r = await aplicaLot(db, [pas('a', 7, 39, 10, REF), pas('b', 7, 39, 5, REF2)])
    expect(r.aplicate).toEqual(['a', 'b'])
    expect(tabel.get(7).cantitate_total).toBe(44)
  })
  it('clientul aruncă la scriere → rândul e „necunoscut”, lotul se oprește, nimic după el', async () => {
    const { db, jurnal } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }], { laUpdate: () => { throw new Error('Failed to fetch') } })
    const r = await aplicaLot(db, [pas('a', 7, 29, 10, REF), pas('b', 7, 29, 5, REF2)])
    expect(r.aplicate).toEqual([])
    expect(r.oprit).toMatchObject({ k: 'a', stare: 'necunoscut' })
    expect(jurnal.update).toHaveLength(1)
  })
})

// ── P3: cantitate cu virgulă și trei zecimale ──
describe('r2 P3: „1,001” (virgulă, 3 zecimale) e valid de la formular până la scriere', () => {
  it('validarea dă numărul 1.001, iar adunarea și scrierea îl acceptă (nu-l mai tratează ca text ambiguu)', async () => {
    const p = pregatesteIntrare({ um: 'kg', form: { cantitate: '1,001' }, azi: AZI, ref: REF })
    expect(p).toMatchObject({ ok: true, cantitate: 1.001, linie: `Intrare +1,001 kg · ${AZI} · ref ${REF}` })
    expect(sumaStoc(29, p.cantitate)).toEqual({ ok: true, total: 30.001, text: '30.001' })
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }])
    expect(await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: p.cantitate, linie: p.linie, ref: REF })).toEqual({ stare: 'ok', total: 30.001 })
    expect(tabel.get(7).cantitate_total).toBe(30.001)
  })
  it('alte forme numerice cu 3 zecimale: 12,345 și 999,999 (număr după validare)', () => {
    for (const [t, n, total] of [['12,345', 12.345, 41.345], ['999,999', 999.999, 1028.999]]) {
      const v = validareIntrare({ cantitate: t }, AZI)
      expect(v.cantitate).toBe(n)
      expect(eroareCantitateIntrare(v.cantitate)).toBe('')
      expect(sumaStoc(29, v.cantitate).total).toBe(total)
    }
  })
  it('lotul din factură: rândul cu „1,001” se adună', async () => {
    const p = pregatesteIntrare({ um: 'kg', form: { cantitate: '1,001' }, azi: AZI, ref: REF })
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }])
    expect((await aplicaLot(db, [{ k: 'a', id: 7, totalVazut: 29, primit: p.cantitate, linie: p.linie, ref: REF }])).oprit).toBe(null)
    expect(tabel.get(7).cantitate_total).toBe(30.001)
  })
  it('TEXTUL „1.001” / „1.000” (punct, scris de om) rămâne ambiguu → refuz, ca înainte', () => {
    for (const t of ['1.001', '1.000', ' 12.500 ']) {
      expect(eroareCantitateIntrare(t)).toMatch(/ambigu/)
      expect(validareIntrare({ cantitate: t }, AZI).ok).toBe(false)
      expect(sumaStoc(29, t).ok).toBe(false)
    }
  })
  it('prețul „1.500” (text) rămâne ambiguu; „1,5” trece', () => {
    expect(validareIntrare({ cantitate: '1', pret: '1.500' }, AZI).ok).toBe(false)
    expect(validareIntrare({ cantitate: '1', pret: '1,5' }, AZI)).toMatchObject({ ok: true, pret: 1.5 })
  })
})

// ── P4: referința legată de conținutul intrării ──
describe('r2 P4: aceeași referință cu alt conținut nu e raportată ca succes și nu se adună', () => {
  const linie = (cant, factura, ref = REF, azi = AZI) => linieIntrare({ cantitate: cant, um: 'buc', facturaNr: factura, dataIntrare: azi, ref })
  const L10 = linie(10, 'F1')

  it('stareRef: absent / aceeași linie / alt conținut / două linii / token mai lung', () => {
    expect(stareRef(null, L10, REF)).toBe('absent')
    expect(stareRef('vechi', L10, REF)).toBe('absent')
    expect(stareRef(`vechi\n${L10}`, L10, REF)).toBe('aceeasi')
    expect(stareRef(`vechi\r\n${L10}\r\n`, L10, REF)).toBe('aceeasi')
    expect(stareRef(`vechi\n${linie(15, 'F1')}`, L10, REF)).toBe('alta')
    expect(stareRef(`${L10}\n${L10}`, L10, REF)).toBe('alta')
    expect(stareRef(`${L10} (corectat de mână)`, L10, REF)).toBe('alta')
    expect(stareRef(`vechi · ref ${REF}9`, L10, REF)).toBe('absent')
    expect(stareRef(`vechi · xref ${REF}`, L10, REF)).toBe('absent')
  })

  it('cazul din verdict: rezultat necunoscut (scrierea +10 a ajuns), apoi formularul schimbat la +15 cu același ref → eroare, nu „deja”, nimic scris', async () => {
    const { db, tabel, jurnal } = dbFals([{ id: 7, cantitate_total: 39, observatii: `Factura 1\n${L10}`, activ: true }])
    const r = await aplicaIntrare(db, { id: 7, totalVazut: 39, primit: 15, linie: linie(15, 'F1'), ref: REF })
    expect(r).toEqual({ stare: 'eroare', mesaj: MESAJ_REF_ALT })
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
  it('aceeași cantitate, altă factură, același ref → eroare (factura face parte din intenție)', async () => {
    const { db, jurnal } = dbFals([{ id: 7, cantitate_total: 39, observatii: L10, activ: true }])
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 39, primit: 10, linie: linie(10, 'F2'), ref: REF })).stare).toBe('eroare')
    expect(jurnal.update).toHaveLength(0)
  })
  it('retrimitere IDENTICĂ (aceeași zi fixată) → „deja”, total neschimbat', async () => {
    const { db, tabel } = dbFals([{ id: 7, cantitate_total: 39, observatii: L10, activ: true }])
    const p = pregatesteIntrare({ um: 'buc', form: { cantitate: '10', facturaNr: 'F1' }, azi: AZI, ref: REF })
    expect(p.linie).toBe(L10)
    expect(await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: p.cantitate, linie: p.linie, ref: REF })).toEqual({ stare: 'deja', total: 39 })
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
  it('retrimitere a doua zi FĂRĂ ziua fixată → linie diferită → eroare (de aceea UI-ul fixează ziua primei încercări)', async () => {
    const { db, jurnal } = dbFals([{ id: 7, cantitate_total: 39, observatii: L10, activ: true }])
    const p = pregatesteIntrare({ um: 'buc', form: { cantitate: '10', facturaNr: 'F1' }, azi: '2026-11-21', ref: REF })
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 39, primit: p.cantitate, linie: p.linie, ref: REF })).stare).toBe('eroare')
    expect(jurnal.update).toHaveLength(0)
  })
  it('linia cu ref-ul editată de mână în observații → eroare, NU o a doua adunare', async () => {
    const { db, tabel, jurnal } = dbFals([{ id: 7, cantitate_total: 39, observatii: `${L10} — verificat`, activ: true }])
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 39, primit: 10, linie: L10, ref: REF })).stare).toBe('eroare')
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(7).cantitate_total).toBe(39)
  })
  it('după UPDATE neconfirmat, recitirea găsește ref-ul cu alt conținut → eroare, nu „deja”', async () => {
    const { db } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }], {
      laUpdate: t => { Object.assign(t.get(7), { cantitate_total: 44, observatii: linie(15, 'F1') }); return { data: null, error: { message: 'Failed to fetch' } } },
    })
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: 10, linie: L10, ref: REF })).stare).toBe('eroare')
  })
  it('după UPDATE neconfirmat, recitirea găsește EXACT linia noastră → „deja” (calea legitimă rămâne)', async () => {
    const { db } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }], {
      laUpdate: (t, q) => { Object.assign(t.get(7), q.valori); return { data: null, error: { message: 'Failed to fetch' } } },
    })
    expect(await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: 10, linie: L10, ref: REF })).toEqual({ stare: 'deja', total: 39 })
  })
  // r3: creatDeja (doar după ref) a fost înlocuit de judecaRandFactura (ref + conținut); testele r3 acoperă și respingerea.
  it('judecaRandFactura: rândul nou creat la o încercare cu rezultat necunoscut se recunoaște după ref (și doar după ref-ul lui)', () => {
    const rand = r => ({ k: 1, denumire: 'Cască', cantitate: '5', um: 'buc', ref: r, cheie: `${r}-0000-4000-8000-000000000000`, tinta: 'nou' })
    const FACT = { nr: 'F1', data: AZI, furnizor: '', categorie: 'eip' }
    const ech = { id: 9, ...randNou(rand(REF), FACT).payload, activ: true }
    const lista = [ech, { id: 10, denumire: 'Vestă', observatii: null }]
    expect(judecaRandFactura(rand(REF), randNou(rand(REF), FACT), lista)).toMatchObject({ stare: 'creat', echip: { id: 9 } })
    expect(judecaRandFactura(rand(REF2), randNou(rand(REF2), FACT), lista)).toEqual({ stare: 'absent' })
    expect(judecaRandFactura(rand('.*'), randNou(rand('.*'), FACT), lista)).toEqual({ stare: 'absent' })
    expect(judecaRandFactura(rand(REF), randNou(rand(REF), FACT), [{ id: 9, observatii: `ref ${REF}0` }])).toEqual({ stare: 'absent' })
    expect(judecaRandFactura(rand(REF), randNou(rand(REF), FACT), [])).toEqual({ stare: 'absent' })
  })
  it('scenariul: inserarea „Cască” 5 a ajuns, rezultatul s-a pierdut; după reîncărcare rândul creat apare ca potrivire — fără ref s-ar aduna +5 (10); cu ref e recunoscut, iar scrierea directă pe el e refuzată', async () => {
    const rand = { k: 1, denumire: 'Cască', um: 'buc', cantitate: '5', ref: REF, cheie: `${REF}-0000-4000-8000-000000000000`, tinta: 'nou' }
    const FACT = { nr: 'F1', data: '', furnizor: '', categorie: 'eip' }
    const creat = { id: 9, ...randNou(rand, FACT).payload, activ: true }
    expect(creat.observatii).toBe(`Intrare inițială 5 buc · Factura F1 · ref ${REF}`)
    // fără recunoaștere, potrivirea implicită ar fi rândul tocmai creat
    expect(potrivireExistente(rand, 'eip', [creat], new Set()).map(p => p.id)).toEqual([9])
    expect(judecaRandFactura(rand, randNou(rand, FACT), [creat])).toMatchObject({ stare: 'creat', echip: { id: 9 } })
    // apărare în adâncime: chiar dacă ecranul n-ar recunoaște rândul, adunarea pe el cu același ref e refuzată
    const { db, tabel, jurnal } = dbFals([creat])
    const p = pregatesteIntrare({ um: 'buc', form: { cantitate: '5', facturaNr: 'F1' }, azi: AZI, ref: REF })
    expect((await aplicaIntrare(db, { id: 9, totalVazut: 5, primit: p.cantitate, linie: p.linie, ref: REF })).stare).toBe('eroare')
    expect(jurnal.update).toHaveLength(0)
    expect(tabel.get(9).cantitate_total).toBe(5)
  })
  it('ref invalid (nu 8 hex) sau linie pe mai multe rânduri → refuz înainte de orice citire', async () => {
    const { db, jurnal } = dbFals([{ id: 7, cantitate_total: 29, observatii: null, activ: true }])
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: 10, linie: 'Intrare +10 buc · ref .*', ref: '.*' })).stare).toBe('eroare')
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: 10, linie: `Intrare +10 buc\n· ref ${REF}`, ref: REF })).stare).toBe('eroare')
    expect((await aplicaIntrare(db, { id: 7, totalVazut: 29, primit: 10, linie: `Intrare +10 buc · ref ${REF2}`, ref: REF })).stare).toBe('eroare')
    expect(jurnal.citiri).toBe(0)
  })
})
