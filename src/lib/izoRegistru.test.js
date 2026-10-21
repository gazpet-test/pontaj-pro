import { describe, it, expect } from 'vitest'
import { serieCanon, dimensiuneDinRegistru, patchDinRegistru, indexFolosite, sugestiiRegistru, cheieBucata, citesteTot, paznicCereri,
  reimprospateaza, actualizeazaRandInPachet } from './izoRegistru.js'

// un „query builder” fals: .range(de, la) întoarce felia, cel mult maxRows (ca PostgREST cu max-rows), plus count
const fals = (randuri, { maxRows = 1000, faraCount = false, golLa = null } = {}) => () => ({
  range: async (de, la) => {
    const felie = golLa != null && de >= golLa ? [] : randuri.slice(de, Math.min(la + 1, de + maxRows))
    return { data: felie, error: null, count: faraCount ? null : randuri.length }
  },
})

describe('citesteTot — paginare fără trunchiere tăcută (Jak #824 P1)', () => {
  const r = Array.from({ length: 2345 }, (_, i) => ({ id: i }))
  it('max-rows 1000 (implicit): toate rândurile', async () => {
    const { data } = await citesteTot(fals(r))
    expect(data).toHaveLength(2345)
  })
  it('max-rows SUB pagină (300): avansează cu cât a primit, nu sare intervale', async () => {
    const { data } = await citesteTot(fals(r, { maxRows: 300 }))
    expect(data.map(x => x.id)).toEqual(r.map(x => x.id))
  })
  it('pagină goală înainte de total → eroare de incompletitudine', async () => {
    const { data, error } = await citesteTot(fals(r, { golLa: 1000 }))
    expect(data).toBeNull()
    expect(error.message).toMatch(/incompletă/)
  })
  it('fără count → eroare, nu listă', async () => {
    const { data, error } = await citesteTot(fals(r, { faraCount: true }))
    expect(data).toBeNull()
    expect(error.message).toMatch(/count/)
  })
  it('listă goală (count 0) → [] fără eroare', async () => {
    expect((await citesteTot(fals([]))).data).toEqual([])
  })
})

describe('reimprospateaza — continuarea unei salvări vechi după navigare (Jak #824 r3)', () => {
  it('pick pe T12 → navighez la T13 → continuarea T12 reîmprospătează T13, nu T12', async () => {
    const paznic = paznicCereri()
    const idRef = { current: 'T12' }
    paznic.porneste()                            // loadAll(T12)
    let afisat = 'T12'
    const cerute = []
    // salvarea pornită pe T12 (UPDATE în zbor)…
    let gata
    const update = new Promise(r => { gata = r })
    const continuare = (async () => {
      await update
      await reimprospateaza(idRef, paznic, async id => { cerute.push(id); return id }, d => { afisat = d })
    })()
    // …între timp utilizatorul trece pe T13 și loadAll(T13) termină
    idRef.current = 'T13'; paznic.porneste(); afisat = 'T13'
    gata(); await continuare
    expect(cerute).toEqual(['T13'])
    expect(afisat).toBe('T13')
  })
  it('navigare ÎN TIMPUL citirii → răspunsul nu se aplică', async () => {
    const paznic = paznicCereri()
    const idRef = { current: 'T12' }
    paznic.porneste()
    let afisat = 'T12', gata
    const p = reimprospateaza(idRef, paznic, () => new Promise(r => { gata = r }), d => { afisat = d })
    idRef.current = 'T13'; paznic.porneste(); afisat = 'T13'
    gata('T12'); expect(await p).toBe(false)
    expect(afisat).toBe('T13')
  })
})

describe('actualizeazaRandInPachet — CAS pe pachet (Copilot #824 r3)', () => {
  const client = (randuriAfectate) => {
    const apel = {}
    const q = {
      update(p) { apel.patch = p; return q },
      eq(k, v) { apel[k] = v; return q },
      select() { return Promise.resolve({ data: Array.from({ length: randuriAfectate }, () => ({ id: apel.id })), error: null }) },
    }
    return { apel, from(t) { apel.tabel = t; return q } }
  }
  it('rândul e încă în pachet → un rând, ok; filtrul pe pachet e trimis', async () => {
    const c = client(1)
    expect(await actualizeazaRandInPachet(c, 50, 12, { serie_unica: 'X' })).toEqual({ ok: true })
    expect(c.apel).toMatchObject({ tabel: 'executie_tevi', id: 50, pachet_id: 12 })
  })
  it('rândul a fost mutat de alt utilizator în alt pachet → 0 rânduri → „mutat”, nimic raportat ca scris', async () => {
    expect(await actualizeazaRandInPachet(client(0), 50, 12, { serie_unica: 'X' })).toEqual({ ok: false, mutat: true })
  })
})

describe('paznicCereri — răspunsurile întârziate nu suprascriu pachetul nou (Jak + Copilot #824 P1)', () => {
  const amana = () => { let rez; const p = new Promise(r => { rez = r }); return { p, rez } }
  it('loadAll(T12) întârziat, T13 termină primul, T12 ultimul → starea finală rămâne T13', async () => {
    const paznic = paznicCereri()
    let stare = null
    const incarca = async (id, asteapta) => { const t = paznic.porneste(); await asteapta; if (paznic.curenta(t)) stare = id }
    const a = amana(), b = amana()
    const pa = incarca('T12', a.p)
    const pb = incarca('T13', b.p)
    b.rez(); await pb
    expect(stare).toBe('T13')
    a.rez(); await pa
    expect(stare).toBe('T13')
  })
  it('o reîmprospătare pornită pe T12 e ignorată după trecerea pe T13', async () => {
    const paznic = paznicCereri()
    let stare = null
    paznic.porneste(); stare = 'T12'
    const a = amana()
    const refetch = (async () => { const t = paznic.actuala(); await a.p; if (paznic.curenta(t)) stare = 'T12 reîmprospătat' })()
    paznic.porneste(); stare = 'T13'
    a.rez(); await refetch
    expect(stare).toBe('T13')
  })
})

describe('serieCanon — aceeași regulă ca serie_canon din registru', () => {
  it('scoate spații / . _ / - și face majuscule', () => {
    expect(serieCanon('254-ca 09.771')).toBe('254CA09771')
    expect(serieCanon(' 247ek_08/603 ')).toBe('247EK08603')
  })
  it('gol / null → șir gol', () => {
    expect(serieCanon(null)).toBe('')
    expect(serieCanon(undefined)).toBe('')
  })
})

describe('dimensiuneDinRegistru', () => {
  it('țeava: DIAMETRUXPERETE, ca rândurile existente', () => {
    expect(dimensiuneDinRegistru({ tip_cod: 'teava', diametru_mm: 610, perete_mm: '7.1' })).toBe('610X7.1')
  })
  it('curba: plus unghiul, citibil de extractUnghi', () => {
    const d = dimensiuneDinRegistru({ tip_cod: 'curba', diametru_mm: 610, perete_mm: 8, unghi_curba: '30.0' })
    expect(d).toBe('610X8 30°')
    expect(d.match(/(\d+)\s*[°˚]/)[1]).toBe('30')
  })
  it('fără diametru și perete → null (nu suprascrie)', () => {
    expect(dimensiuneDinRegistru({ tip_cod: 'teava' })).toBeNull()
  })
})

describe('patchDinRegistru', () => {
  it('țeava: serie, șarjă, lungime în m, dimensiune', () => {
    expect(patchDinRegistru({ tip_cod: 'teava', serie: '254CA09771', sarja: 'SA0818', lungime_mm: 12280, diametru_mm: 610, perete_mm: 7.1 }))
      .toEqual({ serie_unica: '254CA09771', sarja: 'SA0818', lungime_m: 12.28, dimensiune: '610X7.1' })
  })
  it('curba: fără lungime; șarja lipsă nu se scrie; unghiul direct din registru', () => {
    expect(patchDinRegistru({ tip_cod: 'curba', serie: '870', sarja: null, lungime_mm: null, diametru_mm: 610, perete_mm: 8, unghi_curba: 20 }))
      .toEqual({ serie_unica: '870', dimensiune: '610X8 20°', unghi_curba: '20°' })
  })
  it('curba cu unghi zecimal: 22.5° rămâne 22.5° (Jak #824 P1-3)', () => {
    const p = patchDinRegistru({ tip_cod: 'curba', serie: '871', diametru_mm: 610, perete_mm: 8, unghi_curba: '22.50' })
    expect(p.unghi_curba).toBe('22.5°')
    expect(p.dimensiune).toBe('610X8 22.5°')
  })
})

describe('sugestiiRegistru', () => {
  const registru = [
    { id: 1, serie: '254CA09771', tip_cod: 'teava' },
    { id: 2, serie: '247EK08603', tip_cod: 'teava' },
    { id: 3, serie: '254CA00001', tip_cod: 'teava' },
  ]
  const folosite = indexFolosite([
    { id: 10, tip_rand: 'teava', serie_unica: '254-CA 09771', pachet: { cod_document_full: '43_GAZ_CTG2_DWG_00001' } },
    { id: 11, tip_rand: 'teava', serie_unica: '247EK08603', pachet: { cod_document_full: '43_GAZ_CTG2_DWG_00002' } },
  ])
  it('fără text: toate, cele folosite în alt rând la final și marcate', () => {
    const l = sugestiiRegistru(registru, folosite, '', 99)
    expect(l.map(x => x.b.id)).toEqual([3, 2, 1])
    expect(l[2].alte[0].cod).toBe('43_GAZ_CTG2_DWG_00001')
  })
  it('rândul curent nu se marchează pe el însuși', () => {
    const l = sugestiiRegistru(registru, folosite, '09771', 10)
    expect(l).toHaveLength(1)
    expect(l[0].alte).toHaveLength(0)
  })
  it('folosite = null (eroare la verificare): nicio marcare, fără excepție', () => {
    const l = sugestiiRegistru(registru, null, '', 99)
    expect(l).toHaveLength(3)
    expect(l.every(x => x.alte.length === 0)).toBe(true)
  })
  it('curbe: cheia e serie + șarjă + unghi — aceeași serie pe altă șarjă / alt unghi NU e marcată (Copilot #824 P2)', () => {
    const curbe = [
      { id: 21, tip_cod: 'curba', serie: '870', sarja: '2520914', unghi_curba: '22.50' },
      { id: 22, tip_cod: 'curba', serie: '870', sarja: '2520914', unghi_curba: '30.00' },
      { id: 23, tip_cod: 'curba', serie: '870', sarja: '2520999', unghi_curba: '22.50' },
    ]
    const f = indexFolosite([{ id: 30, tip_rand: 'curba', serie_unica: '870', sarja: '2520914', unghi_curba: '22.5°', pachet: { cod_document_full: 'P1' } }])
    const l = sugestiiRegistru(curbe, f, '870', 99)
    expect(l.filter(x => x.alte.length).map(x => x.b.id)).toEqual([21])
    expect(cheieBucata(curbe[0])).toBe('C:870|2520914|22.5')
  })
  it('o țeavă și o curbă cu aceeași serie nu se marchează reciproc', () => {
    const f = indexFolosite([{ id: 31, tip_rand: 'curba', serie_unica: '254CA09771', sarja: 'X', unghi_curba: '30°' }])
    expect(sugestiiRegistru(registru, f, '09771', 99)[0].alte).toHaveLength(0)
  })
  it('filtrul e canonic („254-ca” găsește 254CA…)', () => {
    expect(sugestiiRegistru(registru, folosite, '254-ca', 99).map(x => x.b.id).sort()).toEqual([1, 3])
  })
})
