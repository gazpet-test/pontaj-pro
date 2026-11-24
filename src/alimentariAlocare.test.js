import { describe, it, expect } from 'vitest'
import { FARA_CARD, indexCarduri, carduriDisponibile } from './alimentariFaraSantierFiltru.js'
import {
  valoarePostgrest, listaPostgrest, aplicaFiltruCard, citesteIndexCarduri, citesteAlimentariCard,
  citesteAlimentariRecente, salveazaAlocariBulk, planAlocareFaraQr, alocaFaraQr,
} from './alimentariAlocare.js'
import { clientFals, parseazaListaIn } from './alimentariAlocare.testutil.js'

// Corecturi după review #1184 (Jakarinos NO-GO, P2 + L23 / L24 / L25). Rezultatele așteptate sunt scrise de mână
// (numărate pe fixture), nu calculate cu codul testat.

// Scenariul din verdict: cele mai noi 500 de alimentări fără șantier sunt pe GAZPET1, a 501-a (mai veche) pe GAZPET2.
function scenariu501() {
  const r = []
  for (let i = 1; i <= 500; i++) r.push({ id: 1000 + i, data_alimentare: '2026-11-20', card_combustibil: 'GAZPET1', site_id: null })
  r.push({ id: 7, data_alimentare: '2026-10-02', card_combustibil: 'GAZPET2', site_id: null })
  r.push({ id: 8, data_alimentare: '2026-10-03', card_combustibil: 'GAZPET2', site_id: 44 })   // are șantier: nu intră
  return r
}

describe('indexCarduri (o singură definiție, și pentru carduriDisponibile)', () => {
  const R = [
    { id: 1, card_combustibil: 'GAZPET1' }, { id: 2, card_combustibil: ' GAZPET1 ' }, { id: 3, card_combustibil: 'GAZPET10' },
    { id: 4, card_combustibil: 'GAZPET2' }, { id: 5, card_combustibil: null }, { id: 6, card_combustibil: '   ' }, { id: 7, card_combustibil: '' },
  ]
  it('numărul pe card după trim, variantele exacte din BD, fără card = null / gol / spații', () => {
    expect(indexCarduri(R)).toEqual({
      carduri: [
        { card: 'GAZPET1', nr: 2, variante: [' GAZPET1 ', 'GAZPET1'] },
        { card: 'GAZPET2', nr: 1, variante: ['GAZPET2'] },
        { card: 'GAZPET10', nr: 1, variante: ['GAZPET10'] },
      ],
      faraCard: 3,
      varianteFaraCard: ['', '   '],
      total: 7,
    })
  })
  it('carduriDisponibile păstrează forma veche', () => {
    expect(carduriDisponibile(R)).toEqual({ carduri: [{ card: 'GAZPET1', nr: 2 }, { card: 'GAZPET2', nr: 1 }, { card: 'GAZPET10', nr: 1 }], faraCard: 3 })
  })
})

describe('filtrul pe card trimis serverului (textul cererii)', () => {
  it('valorile sunt mereu între ghilimele, cu \\ și " escapate', () => {
    expect(valoarePostgrest('GAZPET 2 ')).toBe('"GAZPET 2 "')
    expect(valoarePostgrest('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(listaPostgrest(['A,B', '(x)'])).toBe('("A,B","(x)")')
  })
  it('lista se citește înapoi identic (parserul fals ca PostgREST)', () => {
    for (const v of [['GAZPET1'], [' GAZPET1 ', 'GAZPET1'], ['a"b\\c', 'A,B', '(x)'], ['', '   ']]) expect(parseazaListaIn(listaPostgrest(v))).toEqual(v)
  })
  it('card: in.(variante); fără card: is.null sau or(is.null, in.(spații))', () => {
    const idx = indexCarduri([{ id: 1, card_combustibil: 'GAZPET1' }, { id: 2, card_combustibil: ' GAZPET1' }, { id: 3, card_combustibil: '  ' }, { id: 4, card_combustibil: null }])
    const urme = (card, i) => { const { client, cereri } = clientFals([]); aplicaFiltruCard(client.from('t').select('id'), card, i); return cereri[0].urme }
    expect(urme('GAZPET1', idx)).toEqual(['card_combustibil=in.(" GAZPET1","GAZPET1")'])
    expect(urme('GAZPET9', idx)).toEqual(['card_combustibil=in.("GAZPET9")'])
    expect(urme(FARA_CARD, idx)).toEqual(['or=(card_combustibil.is.null,card_combustibil.in.("  "))'])
    expect(urme(FARA_CARD, indexCarduri([{ id: 4, card_combustibil: null }]))).toEqual(['card_combustibil=is.null'])
  })
})

describe('L23: lista cardurilor din TOATE alimentările fără șantier (nu din primele 500)', () => {
  it('scenariul din verdict: GAZPET2 (a 501-a) apare în listă; rândul cu șantier nu se numără', async () => {
    const { client, cereri } = clientFals(scenariu501())
    const idx = await citesteIndexCarduri(client)
    expect(idx.carduri.map(c => [c.card, c.nr])).toEqual([['GAZPET1', 500], ['GAZPET2', 1]])
    expect(idx.total).toBe(501)
    // keyset: fiecare pagină filtrează site_id IS NULL, ordonează pe id, iar următoarea pornește după ultimul id
    expect(cereri[0].urme).toEqual(['site_id=is.null'])
    expect(cereri[1].urme).toEqual(['site_id=is.null', 'id=gt.1500'])
    expect(cereri).toHaveLength(2)   // a doua pagină e goală → stop
  })
  it('peste plafonul serverului (max-rows 1000, și plafon sub pas: 300): toate rândurile, până la pagina goală', async () => {
    const r = []
    for (let i = 1; i <= 2500; i++) r.push({ id: i, card_combustibil: i % 5 === 0 ? 'GAZPET3' : (i % 7 === 0 ? null : 'GAZPET4'), site_id: null })
    // numărate de mână: multipli de 5 = 500; multipli de 7 care nu sunt de 5 = 357 - 71 = 286; restul = 1714
    for (const maxRows of [1000, 300]) {
      const { client } = clientFals(r, { maxRows })
      const idx = await citesteIndexCarduri(client)
      expect(idx.carduri.map(c => [c.card, c.nr])).toEqual([['GAZPET3', 500], ['GAZPET4', 1714]])
      expect(idx.faraCard).toBe(286)
      expect(idx.total).toBe(2500)
    }
  })
  it('o pagină cu eroare = eroare (nu listă goală / incompletă)', async () => {
    let n = 0
    const { client } = clientFals(scenariu501(), { maxRows: 100, eroare: () => (++n === 3 ? { message: 'timeout' } : null) })
    await expect(citesteIndexCarduri(client)).rejects.toMatchObject({ message: 'timeout' })
  })
})

describe('alegerea unui card încarcă rândurile LUI, cu filtru pe server', () => {
  it('GAZPET2 (în afara celor mai noi 500): rândul se încarcă; fără limita de 500', async () => {
    const { client, cereri } = clientFals(scenariu501())
    const idx = await citesteIndexCarduri(client)
    const n0 = cereri.length
    const rows = await citesteAlimentariCard(client, 'GAZPET2', idx)
    expect(rows.map(a => a.id)).toEqual([7])
    // filtrul e pe server: site_id IS NULL + cardul în cerere (nu doar în client)
    expect(cereri[n0].urme).toEqual(['site_id=is.null', 'card_combustibil=in.("GAZPET2")'])
    const g1 = await citesteAlimentariCard(client, 'GAZPET1', idx)
    expect(g1).toHaveLength(500)
  })
  it('variantele cu spații intră; GAZPET20 nu intră la GAZPET2; ordinea = data desc, id desc', async () => {
    const R = [
      { id: 1, data_alimentare: '2026-11-01', card_combustibil: 'GAZPET2', site_id: null },
      { id: 2, data_alimentare: '2026-11-05', card_combustibil: ' GAZPET2 ', site_id: null },
      { id: 3, data_alimentare: '2026-11-05', card_combustibil: 'GAZPET2', site_id: null },
      { id: 4, data_alimentare: '2026-11-09', card_combustibil: 'GAZPET20', site_id: null },
      { id: 5, data_alimentare: '2026-11-09', card_combustibil: 'GAZPET2', site_id: 3 },
    ]
    const { client } = clientFals(R)
    const idx = await citesteIndexCarduri(client)
    expect((await citesteAlimentariCard(client, 'GAZPET2', idx)).map(a => a.id)).toEqual([3, 2, 1])
    expect((await citesteAlimentariCard(client, 'GAZPET20', idx)).map(a => a.id)).toEqual([4])
  })
  it('„fără card” = null, gol și doar spații; cardurile reale nu intră', async () => {
    const R = [
      { id: 1, data_alimentare: '2026-11-01', card_combustibil: null, site_id: null },
      { id: 2, data_alimentare: '2026-11-02', card_combustibil: '', site_id: null },
      { id: 3, data_alimentare: '2026-11-03', card_combustibil: '   ', site_id: null },
      { id: 4, data_alimentare: '2026-11-04', card_combustibil: 'GAZPET1', site_id: null },
    ]
    const { client } = clientFals(R)
    const idx = await citesteIndexCarduri(client)
    expect((await citesteAlimentariCard(client, FARA_CARD, idx)).map(a => a.id)).toEqual([3, 2, 1])
  })
  it('un card cu peste 1000 de rânduri (plafonul serverului): toate', async () => {
    const R = []
    for (let i = 1; i <= 1234; i++) R.push({ id: i, data_alimentare: '2026-11-10', card_combustibil: 'GAZPET5', site_id: null })
    const { client } = clientFals(R)
    const idx = await citesteIndexCarduri(client)
    expect(await citesteAlimentariCard(client, 'GAZPET5', idx)).toHaveLength(1234)
  })
  it('fără card ales: cele mai noi 500 + totalul (pentru avertismentul de trunchiere)', async () => {
    const { client } = clientFals(scenariu501())
    const { randuri, total } = await citesteAlimentariRecente(client)
    expect(randuri).toHaveLength(500)
    expect(randuri.some(a => a.id === 7)).toBe(false)
    expect(total).toBe(501)
  })
})

describe('L25: salvarea din Bulk e CAS pe site_id IS NULL (probe pe tabelul fals)', () => {
  const baza = () => [1, 2, 3].map(id => ({ id, card_combustibil: 'GAZPET1', site_id: null, sursa_alocare_santier: null }))
  it('rândul alocat între timp de altcineva NU se suprascrie și se numără conflict; restul se scriu cu audit', async () => {
    const { client, tabel } = clientFals(baza(), {
      inainteDeUpdate: (st, t) => { if (st.urme.includes('id=eq.2')) t.find(r => r.id === 2).site_id = 99 },   // alt utilizator, chiar înainte
    })
    const rez = await salveazaAlocariBulk(client, [{ id: 1, site_id: 17 }, { id: 2, site_id: 17 }, { id: 3, site_id: 18 }], { profileId: 'u-1', acum: 'T' })
    expect(rez).toEqual({ success: 2, conflicte: 1, errors: [] })
    expect(tabel).toEqual([
      { id: 1, card_combustibil: 'GAZPET1', site_id: 17, sursa_alocare_santier: 'manual', aloc_santier_de: 'u-1', aloc_santier_la: 'T' },
      { id: 2, card_combustibil: 'GAZPET1', site_id: 99, sursa_alocare_santier: null },
      { id: 3, card_combustibil: 'GAZPET1', site_id: 18, sursa_alocare_santier: 'manual', aloc_santier_de: 'u-1', aloc_santier_la: 'T' },
    ])
  })
  it('eroare de server / cerere respinsă = eroare, nu conflict; lotul continuă', async () => {
    const { client, tabel } = clientFals(baza(), {
      eroare: st => (st.op !== 'update' ? null : st.urme.includes('id=eq.1') ? { message: 'JWT expired' } : st.urme.includes('id=eq.2') ? 'respinge' : null),
    })
    const rez = await salveazaAlocariBulk(client, [{ id: 1, site_id: 17 }, { id: 2, site_id: 17 }, { id: 3, site_id: 17 }], { acum: 'T' })
    expect(rez).toEqual({ success: 1, conflicte: 0, errors: [{ id: 1, msg: 'JWT expired' }, { id: 2, msg: 'Failed to fetch' }] })
    expect(tabel.map(r => r.site_id)).toEqual([null, null, 17])
  })
  it('loturi de 30: 65 de alocări = 65 de UPDATE-uri, toate cu CAS', async () => {
    const R = Array.from({ length: 65 }, (_, i) => ({ id: i + 1, site_id: null }))
    const { client, cereri } = clientFals(R)
    const rez = await salveazaAlocariBulk(client, R.map(r => ({ id: r.id, site_id: 5 })), { acum: 'T' })
    expect(rez.success).toBe(65)
    expect(cereri.filter(c => c.op === 'update')).toHaveLength(65)
    cereri.forEach((c, i) => expect(c.urme).toEqual([`id=eq.${i + 1}`, 'site_id=is.null']))
  })
})

describe('L25: alocarea „fără QR” e CAS pe qr_status și pe șantierul citit', () => {
  const rand = (o = {}) => ({ id: 50, qr_status: 'real_fara_qr', site_id: null, active_id: null, sursa_alocare_santier: null, ...o })
  it('planul: șantier neschimbat (pus din Bulk) = nu se rescrie; schimbat = manual; fără șantier = sursa null', () => {
    expect(planAlocareFaraQr(rand({ site_id: 7 }), 3, 7)).toEqual({ upd: { active_id: 3, qr_status: 'matched' }, siteVechi: 7 })
    expect(planAlocareFaraQr(rand({ site_id: 7 }), 3, 9)).toEqual({ upd: { active_id: 3, qr_status: 'matched', site_id: 9, sursa_alocare_santier: 'manual' }, siteVechi: 7 })
    expect(planAlocareFaraQr(rand({ site_id: 7 }), 3, null)).toEqual({ upd: { active_id: 3, qr_status: 'matched', site_id: null, sursa_alocare_santier: null }, siteVechi: 7 })
    expect(planAlocareFaraQr(rand(), 3, null)).toEqual({ upd: { active_id: 3, qr_status: 'matched', sursa_alocare_santier: null }, siteVechi: null })
  })
  it('șantierul pus din Bulk se păstrează, cu sursa lui (manual)', async () => {
    const { client, tabel, cereri } = clientFals([rand({ site_id: 7, sursa_alocare_santier: 'manual' })])
    expect(await alocaFaraQr(client, rand({ site_id: 7 }), 3, 7)).toBe('ok')
    expect(tabel[0]).toEqual({ id: 50, qr_status: 'matched', site_id: 7, active_id: 3, sursa_alocare_santier: 'manual' })
    expect(cereri[0].urme).toEqual(['id=eq.50', 'qr_status=eq.real_fara_qr', 'site_id=eq.7'])
  })
  it('alt șantier pus între timp (citit null, acum 12) = conflict, nimic scris', async () => {
    const { client, tabel } = clientFals([rand()], { inainteDeUpdate: (st, t) => { t[0].site_id = 12 } })
    expect(await alocaFaraQr(client, rand(), 3, 9)).toBe('conflict')
    expect(tabel[0]).toEqual(rand({ site_id: 12 }))
  })
  it('alimentarea legată între timp de alt utilizator (qr_status = matched) = conflict, nimic scris', async () => {
    const { client, tabel } = clientFals([rand({ site_id: 7 })], { inainteDeUpdate: (st, t) => { t[0].qr_status = 'matched'; t[0].active_id = 11 } })
    expect(await alocaFaraQr(client, rand({ site_id: 7 }), 3, 7)).toBe('conflict')
    expect(tabel[0]).toEqual(rand({ site_id: 7, qr_status: 'matched', active_id: 11 }))
  })
  it('eroarea serverului se aruncă (nu e conflict, nu e succes)', async () => {
    const { client } = clientFals([rand()], { eroare: () => ({ message: 'permission denied' }) })
    await expect(alocaFaraQr(client, rand(), 3, 9)).rejects.toMatchObject({ message: 'permission denied' })
  })
})
