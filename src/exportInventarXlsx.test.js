import { describe, it, expect } from 'vitest'
import XLSX from 'xlsx-js-style'
import JSZip from 'jszip'
import {
  construiesteRanduriInventar, generateInventarXlsx, parseazaDimensiune, pozitieSemnatura, buildInventarFilename,
  INVENTAR_ANTET, BLOCAJ_FARA_DEBLOCARE, BLOCAJ_DEBLOCARE_MP, BLOCAJ_AVERTISMENT,
} from './exportInventarXlsx.js'

// Date inventate: tronsonul 99, serii fictive, coordonate rotunde.
const rand = (poz, tip, sud, serie, lung, extra = {}) => ({
  poz_in_pachet: poz, tip_rand: tip, serie_unica: serie, sarja: 'SJ-' + serie, dimensiune: '610X7.1', lungime_m: lung,
  sudura_cod: sud, poz_km_m: null, ...extra,
})
const PACHETE = [
  { id: 11, cod_document_full: 'DOC-P1', revizie: 1, km_start_m: 87.8, tronson: 'T99', tevi: [
    rand(1, 'teava', 'T99S1', 'FX-01', 12.2, { poz_km_m: 100 }),
    rand(2, 'curba', 'T99S2', 'FX-02', 3.5, { poz_km_m: 103.5, unghi_curba: '20°', dimensiune: '610X7.1 20°' }),
    rand(3, 'teava', 'T99S3', 'FX-03', 11.6, { poz_km_m: 115.1 }),
  ] },
  { id: 12, cod_document_full: 'DOC-P2', revizie: 0, km_start_m: 115.1, tronson: 'T99', tevi: [
    { poz_in_pachet: 1, tip_rand: 'separator' },
    rand(2, 'curba', 'T99S4', 'FX-04', 2.1, { poz_km_m: 117.2, unghi_curba: '22.5°', dimensiune: '610X8' }),
    rand(3, 'teava', 'T99S5', 'FX-05', 12, { poz_km_m: 129.2 }),
  ] },
]
const COORD = [
  { cheie: '99|1|', x: 1000, y: 2000, z: 300 },
  { cheie: '99|3|', x: 1010.5, y: 2003.25, z: 301.125 },
  { cheie: '99|4|', x: 1012, y: 2004, z: 301 },
  { cheie: '99|5|', x: 1024, y: 2004, z: 301 },
  { cheie: '99|77|', x: 1, y: 2, z: 3 }, // fără sudură în pachete
]
const CLASE = [{ km_de: 0, km_pana: 110, clasa: '1b' }, { km_de: 110, km_pana: 120, clasa: '2' }, { km_de: 120, km_pana: 129, clasa: '2' }]

describe('construiesteRanduriInventar', () => {
  const { randuri, lipsuri } = construiesteRanduriInventar({ pachete: PACHETE, coordonate: COORD, clase: CLASE })
  const dupa = nr => randuri.find(r => r.nrSudura === nr)
  const lipsa = (nr, motiv) => lipsuri.filter(l => l.nrSudura === nr && l.motiv === motiv)

  it('intră DOAR sudurile cu coordonate confirmate (S2 nu are)', () => {
    expect(randuri.map(r => r.nrSudura)).toEqual(['T99S1', 'T99S3', 'T99S4', 'T99S5'])
    expect(lipsa('T99S2', 'fara_coordonate')).toEqual([expect.objectContaining({ blocheaza: BLOCAJ_DEBLOCARE_MP, inInventar: false })])
  })
  it('amonte = elementul rândului, aval = următorul element; curba ca „CURBA N°”', () => {
    expect(dupa('T99S1').amonte).toEqual({ tip: 'TEAVA', diametru: 610, grosime: '7.1mm', lungime: 12.2, serie: 'FX-01', sarja: 'SJ-FX-01' })
    expect(dupa('T99S1').aval).toEqual({ tip: 'CURBA 20°', diametru: 610, grosime: '7.1mm', lungime: 3.5, serie: 'FX-02', sarja: 'SJ-FX-02' })
  })
  it('aval peste granița de pachet, cu separatorul sărit; unghi zecimal păstrat', () => {
    expect(dupa('T99S3').pachet).toBe('DOC-P1 rev.1')
    expect(dupa('T99S3').aval).toMatchObject({ tip: 'CURBA 22.5°', serie: 'FX-04', diametru: 610, grosime: '8mm' })
    expect(dupa('T99S4').pachet).toBe('DOC-P2')
  })
  it('ultima sudură a tronsonului fără element aval: rămâne, cu aval gol, AVERTISMENT „capăt de tronson” (R8)', () => {
    expect(dupa('T99S5').aval).toBeNull()
    expect(lipsa('T99S5', 'capat_de_tronson')).toEqual([expect.objectContaining({ blocheaza: BLOCAJ_AVERTISMENT, inInventar: true })])
    expect(lipsa('T99S5', 'fara_element_aval')).toEqual([])
    // un tronson cu o singură sudură (cazul din review): avertisment, nu blocaj
    const unu = construiesteRanduriInventar({ pachete: [{ id: 1, cod_document_full: 'D', km_start_m: 0, tronson: 99, tevi: [rand(1, 'teava', 'T99S1', 'FX-1', 12)] }],
      coordonate: [{ cheie: '99|1|', x: 0, y: 0, z: 0 }] })
    expect(unu.lipsuri.filter(l => l.blocheaza === BLOCAJ_FARA_DEBLOCARE)).toEqual([])
    expect(unu.lipsuri.map(l => [l.motiv, l.blocheaza])).toContainEqual(['capat_de_tronson', BLOCAJ_AVERTISMENT])
  })
  it('sudura fără element aval care NU e ultima pe tronson: blocaj fără deblocare (R8)', () => {
    // E(S1) · legare S2: S1 nu are element după ea, dar urmează S2 → documentul ar ieși greșit
    const p = [{ id: 1, cod_document_full: 'D', km_start_m: 0, tronson: 99, tevi: [rand(1, 'teava', 'T99S1', 'FX-1', 12), { poz_in_pachet: 2, tip_rand: 'legare', sudura_cod: 'T99S2' }] }]
    const r = construiesteRanduriInventar({ pachete: p, coordonate: [{ cheie: '99|1|', x: 0, y: 0, z: 0 }, { cheie: '99|2|', x: 0, y: 0, z: 1 }] })
    const m = nr => r.lipsuri.filter(l => l.nrSudura === nr && /aval|capat/.test(l.motiv)).map(l => [l.motiv, l.blocheaza])
    expect(m('T99S1')).toEqual([['fara_element_aval', BLOCAJ_FARA_DEBLOCARE]])
    expect(m('T99S2')).toEqual([['capat_de_tronson', BLOCAJ_AVERTISMENT]])
  })
  it('pachetele primite în altă ordine: ordinea fizică vine din km start (R7)', () => {
    const invers = construiesteRanduriInventar({ pachete: [PACHETE[1], PACHETE[0]], coordonate: COORD, clase: CLASE })
    expect(invers.randuri.map(r => r.nrSudura)).toEqual(['T99S1', 'T99S3', 'T99S4', 'T99S5'])
    const s3 = invers.randuri.find(r => r.nrSudura === 'T99S3')
    expect(s3.aval).toMatchObject({ serie: 'FX-04' })
    expect(invers.randuri.find(r => r.nrSudura === 'T99S5').aval).toBeNull()
    expect(invers.lipsuri.filter(l => l.motiv === 'fara_element_aval')).toEqual([])
  })
  it('sudurile eliminate prin tăiere nu intră și nu cer coordonate; se listează ca avertisment (R4, R8)', () => {
    const r = construiesteRanduriInventar({ pachete: PACHETE, coordonate: COORD, clase: CLASE, eliminate: new Set(['99|3|', '99|2|']) })
    expect(r.randuri.map(x => x.nrSudura)).toEqual(['T99S1', 'T99S4', 'T99S5'])
    expect(r.lipsuri.filter(l => l.motiv === 'sudura_eliminata').map(l => [l.nrSudura, l.blocheaza, l.inInventar]))
      .toEqual([['T99S2', BLOCAJ_AVERTISMENT, false], ['T99S3', BLOCAJ_AVERTISMENT, false]])
    // S2 nu are coordonate, dar e eliminată → nu e „fără coordonate”; coordonatele lui S3 nu sunt „fără sudură”
    expect(r.lipsuri.filter(l => l.motiv === 'fara_coordonate')).toEqual([])
    expect(r.lipsuri.filter(l => l.motiv === 'coordonate_fara_sudura').map(l => l.cheie)).toEqual(['99|77|'])
    expect(r.lipsuri.filter(l => l.motiv === 'coordonate_sudura_eliminata').map(l => [l.cheie, l.blocheaza])).toEqual([['99|3|', BLOCAJ_AVERTISMENT]])
    // elementele sudurii eliminate rămân: S1 își păstrează avalul (curba FX-02)
    expect(r.randuri[0].aval).toMatchObject({ serie: 'FX-02' })
    // listă simplă de chei = același efect
    expect(construiesteRanduriInventar({ pachete: PACHETE, coordonate: COORD, clase: CLASE, eliminate: ['99|3|'] }).randuri.map(x => x.nrSudura)).not.toContain('T99S3')
  })
  it('sudura din mai multe pachete în cumulat: rămâne apariția din revizia cea mai nouă, conflictul se listează (R7)', () => {
    // S3 apare și în DOC-P2 (rev.0, ca refacere „R”): aceeași cheie → rămâne cea din DOC-P1 rev.1
    const p2 = { ...PACHETE[1], tevi: [...PACHETE[1].tevi, rand(4, 'teava', 'T99S3R', 'FX-06', 5, { poz_km_m: 134.2 })] }
    const r = construiesteRanduriInventar({ pachete: [PACHETE[0], p2], coordonate: COORD, clase: CLASE })
    const s3 = r.randuri.filter(x => x.cheie === '99|3|')
    expect(s3).toHaveLength(1)
    expect(s3[0]).toMatchObject({ pachet: 'DOC-P1 rev.1', nrSudura: 'T99S3' })
    expect(r.conflicte).toEqual([expect.objectContaining({ motiv: 'sudura_dublata_in_pachete', cheie: '99|3|',
      pastrata: expect.objectContaining({ pachet: 'DOC-P1 rev.1', poz: 3 }), ignorate: [expect.objectContaining({ pachet: 'DOC-P2', poz: 4, cod: 'T99S3R' })] })])
    expect(r.lipsuri.filter(l => l.motiv === 'sudura_dublata_in_pachete').map(l => [l.blocheaza, l.inInventar])).toEqual([[BLOCAJ_AVERTISMENT, true]])
  })
  it('clasa din POZ KM; la granița a două clase diferite și fără interval → null + lipsă', () => {
    expect(dupa('T99S1').clasaLocatie).toBe('1b')
    expect(dupa('T99S4').clasaLocatie).toBe('2')
    expect(dupa('T99S3').clasaLocatie).toBe('2')
    expect(dupa('T99S5').clasaLocatie).toBeNull() // 129,2 în afara intervalelor
    expect(lipsa('T99S5', 'fara_clasa')[0].blocheaza).toBe(BLOCAJ_DEBLOCARE_MP)
    const g = construiesteRanduriInventar({ pachete: PACHETE, coordonate: COORD, clase: [{ km_de: 0, km_pana: 100, clasa: '1b' }, { km_de: 100, km_pana: 200, clasa: '2' }] })
    expect(g.randuri[0].clasaLocatie).toBeNull()
    expect(g.lipsuri.find(l => l.nrSudura === 'T99S1' && l.motiv === 'clasa_la_granita').detaliu).toBe('1b / 2')
  })
  it('coordonatele fără sudură în pachete se semnalează', () => {
    expect(lipsuri.filter(l => l.motiv === 'coordonate_fara_sudura').map(l => l.cheie)).toEqual(['99|77|'])
  })
  it('coordonatele în inventar = cele confirmate, neschimbate', () => {
    expect(dupa('T99S3')).toMatchObject({ x: 1010.5, y: 2003.25, z: 301.125, tronson: 99, situatie: null })
  })
  it('element fără serie / lungime și dimensiune nerecunoscută = blocaj fără deblocare', () => {
    const p = [{ cod_document_full: 'D', tronson: 99, tevi: [rand(1, 'teava', 'T99S1', '', null, { dimensiune: 'DN600' }), rand(2, 'teava', 'T99S2', 'FX-9', 12)] }]
    const r = construiesteRanduriInventar({ pachete: p, coordonate: [{ cheie: '99|1|', x: 0, y: 0, z: 0 }], clase: [] })
    const m = r.lipsuri.filter(l => l.nrSudura === 'T99S1').map(l => [l.motiv, l.blocheaza])
    expect(m).toEqual(expect.arrayContaining([
      ['element_fara_serie', BLOCAJ_FARA_DEBLOCARE], ['element_fara_lungime', BLOCAJ_FARA_DEBLOCARE],
      ['dimensiune_nerecunoscuta', BLOCAJ_FARA_DEBLOCARE], ['fara_poz_km', BLOCAJ_DEBLOCARE_MP],
    ]))
    expect(r.randuri[0].amonte).toMatchObject({ serie: '', lungime: null, diametru: null, grosime: '' })
  })
  it('coordonate contradictorii pentru aceeași sudură: nu intră, blocaj', () => {
    const r = construiesteRanduriInventar({ pachete: PACHETE, coordonate: [...COORD, { cheie: '99|1|', x: 1000.5, y: 2000, z: 300 }], clase: CLASE })
    expect(r.randuri.map(x => x.nrSudura)).not.toContain('T99S1')
    expect(r.lipsuri.find(l => l.cheie === '99|1|').motiv).toBe('coordonate_dublate')
  })
})

describe('parseazaDimensiune', () => {
  it('forme recunoscute', () => {
    expect(parseazaDimensiune('610X7.1')).toEqual({ diametru: 610, grosime: 7.1 })
    expect(parseazaDimensiune('610 x 7,1')).toEqual({ diametru: 610, grosime: 7.1 })
    expect(parseazaDimensiune('610X7.1mm')).toEqual({ diametru: 610, grosime: 7.1 })
    expect(parseazaDimensiune('610X7.1 20°')).toEqual({ diametru: 610, grosime: 7.1 })
  })
  it('restul nu se ghicește', () => {
    for (const d of [null, '', 'DN600', '610', '610X', 'X7.1', '610X7.1X3', 'Ø610X7.1 abc']) expect(parseazaDimensiune(d)).toBeNull()
  })
})

describe('generateInventarXlsx — fișierul se poate reciti', () => {
  const { randuri } = construiesteRanduriInventar({ pachete: PACHETE, coordonate: COORD, clase: CLASE })
  const citeste = async (opt) => {
    const bytes = await generateInventarXlsx(opt)
    expect(bytes).toBeInstanceOf(Uint8Array)
    const wb = XLSX.read(bytes, { type: 'array', cellStyles: true })
    return { bytes, wb, ws: wb.Sheets[wb.SheetNames[0]] }
  }

  it('antet pe 2 rânduri, merge-urile modelului, rubrica de semnătură după date', async () => {
    const { wb, ws } = await citeste({ lot: 2, randuri, semnatura: { nume: 'Nume Fictiv' } })
    expect(wb.SheetNames).toEqual(['Sheet1'])
    const antet = 'ABCDEFGHIJKLMNOPQRS'.split('').map(c => ws[c + '1']?.v)
    expect(antet).toEqual(['LOT', 'Nr_Sudura', 'Nr. pachet lansare', 'Nr. situatie de lucrari in care a fost inclusa', 'Tronson',
      'Clasa_Locatie', 'Tip_Element_Amonte', 'Diametru_Amonte', 'Grosime_Amonte', 'Lungime_Amonte', 'Serie_tv_Amonte',
      'Sarja_tv_Amonte', 'Tip_Element_Aval', 'Diametru_Aval', 'Grosime_Aval', 'Lungime_Aval', 'Serie_tv_Aval', 'Sarja_tv_Aval', 'COORDONATE'])
    expect(INVENTAR_ANTET).toHaveLength(21)
    expect(['S2', 'T2', 'U2'].map(a => ws[a].v)).toEqual(['X', 'Y', 'Z'])
    const merges = ws['!merges'].map(m => XLSX.utils.encode_range(m)).sort()
    // 4 rânduri de date (R3..R6), rândul R7 gol, numele în P10:S10
    const asteptate = [...'ABCDEFGHIJKLMNOPQR'.split('').map(c => `${c}1:${c}2`), 'S1:U1', 'P10:S10'].sort()
    expect(merges).toEqual(asteptate)
    expect(ws.P7).toBeUndefined()
  })

  it('poziția semnăturii urmează modelul (323 de rânduri de date → R327 / R328 / P329:S329)', () => {
    const m = pozitieSemnatura(323)
    expect([m.titlu + 1, m.eticheta + 1, m.nume + 1]).toEqual([327, 328, 329])
    expect([m.col, m.mergeColFinal]).toEqual([15, 18]) // P..S
  })

  it('rubrica de semnătură la poziția corectă pentru rândurile date', async () => {
    const { ws } = await citeste({ lot: 2, randuri, semnatura: { nume: 'Nume Fictiv' } })
    // 4 rânduri de date: R3..R6, gol R7, titlu R8, etichetă R9, nume R10 (merge P10:S10)
    expect(ws.P8.v).toBe('Reprezentant Antreprenor')
    expect(ws.P9.v).toBe('NUME IN CLAR SI SEMNATURA')
    expect(ws.P10.v).toBe('Nume Fictiv')
    expect(ws['!merges'].map(m => XLSX.utils.encode_range(m))).toContain('P10:S10')
    expect(ws['!ref']).toBe('A1:U10')
  })

  it('valorile și formatele numerelor (lungime 2 zecimale, coordonate 3)', async () => {
    const { ws } = await citeste({ lot: 2, randuri })
    expect(ws.A3.v).toBe(2)
    expect(ws.B3.v).toBe('T99S1')
    expect(ws.C3.v).toBe('DOC-P1 rev.1')
    expect(ws.D3.v ?? '').toBe('')
    expect(ws.E3.v).toBe(99)
    expect(ws.F3.v).toBe('1b')
    expect([ws.G3.v, ws.H3.v, ws.I3.v, ws.J3.v, ws.K3.v, ws.L3.v]).toEqual(['TEAVA', 610, '7.1mm', 12.2, 'FX-01', 'SJ-FX-01'])
    expect([ws.M3.v, ws.N3.v, ws.O3.v, ws.P3.v, ws.Q3.v]).toEqual(['CURBA 20°', 610, '7.1mm', 3.5, 'FX-02'])
    expect(ws.J3.z).toBe('0.00')
    expect(ws.P3.z).toBe('0.00')
    expect(ws.J3.w).toBe('12.20')
    for (const a of ['S4', 'T4', 'U4']) expect(ws[a].z).toBe('0.000')
    expect([ws.S4.v, ws.T4.v, ws.U4.v]).toEqual([1010.5, 2003.25, 301.125])
    expect(ws.S4.w).toBe('1010.500')
    // aval lipsă la ultima sudură = celule goale, nu inventate
    expect([ws.M6.v, ws.N6.v, ws.Q6.v].map(v => v ?? '')).toEqual(['', '', ''])
  })

  it('lățimile, pagina și stilurile modelului', async () => {
    const { bytes, ws } = await citeste({ lot: 2, randuri })
    const xml = await (await JSZip.loadAsync(bytes)).file('xl/worksheets/sheet1.xml').async('string')
    expect(xml).toContain('<col min="16" max="16" width="26.33203125" customWidth="1"/>')
    expect(xml).toContain('<col min="19" max="21" width="2.44140625" bestFit="1" customWidth="1"/>')
    expect(xml).toContain('<pageSetup orientation="landscape" paperSize="9" scale="52"/>')
    expect(xml).toMatch(/<row r="2"[^>]*ht="83\.4"/)
    const stiluri = await (await JSZip.loadAsync(bytes)).file('xl/styles.xml').async('string')
    for (const f of ['Segoe UI', 'Arial Narrow', 'Calibri']) expect(stiluri).toContain(`"${f}"`)
    expect(stiluri).toContain('formatCode="0.000"')
    expect(ws.A1.v).toBe('LOT')
  })

  it('fără rânduri: doar antetul și rubrica; fără listă = eroare', async () => {
    const { ws } = await citeste({ lot: 2, randuri: [] })
    expect(ws.P4.v).toBe('Reprezentant Antreprenor')
    await expect(generateInventarXlsx({ lot: 2 })).rejects.toThrow()
  })

  it('numele fișierului fără caractere interzise', () => {
    expect(buildInventarFilename('T99/P1')).toBe('Inventar_T99_P1.xlsx')
  })
})
