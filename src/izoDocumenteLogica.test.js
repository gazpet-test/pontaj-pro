import { describe, it, expect } from 'vitest'
import {
  serieCanon, verificaSerie, confuziiNumerice, parseNumar, mmDinM, mDinMm, randGol, randNormalizat, validareRand, validareDocument,
  totaluriDocument, eroriSalvare, rezumatRegistru, parseTsv, campDinAntet, randuriDinLipire, argumenteSalveaza, argumenteConfirma,
  argumentePv, normalizeazaVerificare, lipsaReceptie, mesajEroareDoc, poateScrie, verificaCodCurba, randDinBd, antetDinBd, sha256Hex,
} from './izoDocumenteLogica.js'

// ── documentele de test pv_test (C:\Users\Public\claude-server\pv_test\gen\totals.json, 21.10.2026) ─────────────────
// aviz: [nr_crt, serie, sarja, lot, lungime m, kg]
const AVIZ1 = [[1, '999TS00101', 'TS00011', 901, '6.04', 678], [2, '999TS00102', 'TS00011', 901, '6.11', 686], [3, '999TS00103', 'TS00011', 901, '5.98', 672],
  [4, '999TS00105', 'TS00011', 901, '6.07', 682], [5, '999TS00106', 'TS00011', 901, '6.02', 676], [6, '999TS00107', 'TS00012', 901, '6.12', 687],
  [7, '999TS00109', 'TS00012', 901, '6.00', 674], [8, '999TS00110', 'TS00012', 901, '6.09', 684], [9, '999TS00111', 'TS00012', 902, '6.05', 679],
  [10, '999TS00113', 'TS00012', 902, '5.99', 673], [11, '999TS00114', 'TS00013', 902, '6.08', 683], [12, '999TS00115', 'TS00013', 902, '6.03', 677],
  [13, '999TS00117', 'TS00013', 902, '6.10', 685], [14, '999TS00118', 'TS00013', 902, '6.01', 675], [15, '999TS00119', 'TS00013', 902, '6.06', 681]]
const AVIZ2 = [[1, '999TS00201', 'TS00021', 911, '12.48', 1402], [2, '999TS00203', 'TS00021', 911, '11.86', 1332], [3, '999TS00204', 'TS00021', 911, '12.50', 1404],
  [4, '999TS00206', 'TS00021', 911, '12.13', 1362], [5, '999TS00207', 'TS00022', 911, '11.62', 1305], [6, '999TS00209', 'TS00022', 911, '12.31', 1382],
  [7, '999TS00210', 'TS00022', 912, '11.95', 1342], [8, '999TS00212', 'TS00022', 912, '12.07', 1355], [9, '999TS00213', 'TS00023', 912, '11.50', 1291],
  [10, '999TS00215', 'TS00023', 912, '12.44', 1397], [11, '999TS00216', 'TS00023', 912, '12.22', 1372], [12, '999TS00218', 'TS00023', 912, '11.78', 1323],
  [13, '999TS00219', 'TS00024', 913, '12.36', 1388], [14, '999TS00221', 'TS00024', 913, '12.02', 1350], [15, '999TS00222', 'TS00024', 913, '11.69', 1313]]
// curbe: [bend, code, heat, item, wall, deg, pkg, dims, net, gross]
const CURBE = [[9001, '9001-610-8-5-6100-9990001-1', 9990001, 1, '8', 5, 1, '390X75X135', 1132, 1152],
  [9002, '9002-610-8-12-6100-9990001-1', 9990001, 1, '8', 12, 1, '390X75X135', 1221, 1241], [9003, '9003-610-10-18-6100-9990002-2', 9990002, 2, '10', 18, 2, '420X80X140', 1615, 1635],
  [9004, '9004-610-10-25-6100-9990002-2', 9990002, 2, '10', 25, 2, '420X80X140', 1725, 1745], [9005, '9005-610-8,8-33-6100-9990003-3', 9990003, 3, '8,8', 33, 3, '455X80X150', 1633, 1653],
  [9006, '9006-610-8,8-45-6100-9990003-3', 9990003, 3, '8,8', 45, 3, '455X80X150', 1799, 1819], [9007, '9007-610-8-38-6100-9990001-1', 9990001, 1, '8', 38, 4, '480X85X150', 1549, 1569],
  [9008, '9008-610-8-40-6100-9990004-1', 9990004, 1, '8', 40, 4, '480X85X150', 1575, 1595], [9009, '9009-610-10-50-6100-9990005-2', 9990005, 2, '10', 50, 5, '520X90X160', 2119, 2139],
  [9010, '9010-610-10-55-6100-9990005-2', 9990005, 2, '10', 55, 5, '520X90X160', 2198, 2218], [9011, '9011-610-8,8-22-6100-9990003-3', 9990003, 3, '8,8', 22, 6, '440X80X145', 1480, 1500],
  [9012, '9012-610-8-15-6100-9990004-1', 9990004, 1, '8', 15, 6, '440X80X145', 1259, 1279]]

const randAviz = ([nr, serie, sarja, lot, L, kg], extra = {}) => ({ ...randGol('aviz_teava', nr), serie, sarja, lot: String(lot), lungime_doc: L, greutate_kg: String(kg),
  perete_mm: '7,1', diametru_mm: '610', specificatie: 'Tevi sudate elicoidal 610x7,10 mm, L 360 NE, izolate', ...extra })
const randCurba = ([bend, cod, heat, item, wall, deg, pkg, dims, net, gross], extra = {}) => ({ ...randGol('lista_ambalare_curbe', bend - 9000), serie: String(bend), cod,
  sarja: String(heat), item: String(item), diametru_mm: '610', perete_mm: wall, unghi_doc: String(deg), standard: 'EN 14870-1', cantitate: '1', pachet_nr: String(pkg),
  dimensiuni_cm: dims, net_kg: String(net), brut_kg: String(gross), specificatie: 'INDUCTION BEND', ...extra })
const antet = (nr, tot) => ({ furnizor: 'FURNIZOR TEST SRL', nr_document: nr, data_document: '2026-10-22', ...tot })

const docAviz1 = () => ({ sablon: 'aviz_teava', proiect_id: 77, depozit_id: 5, antet: antet('TEST-2610221', { total_m: '90.75', total_kg: '10,192' }), randuri: AVIZ1.map(r => randAviz(r)) })
const docAviz2 = () => ({ sablon: 'aviz_teava', proiect_id: 77, depozit_id: 5, antet: antet('TEST-2610222', { total_m: '180.93', total_kg: '20,318' }),
  randuri: AVIZ2.map(r => randAviz(r, r[0] === 7 ? { decizie: 'refuzat_la_receptie', motiv: 'fără marcaj vizibil' }
    : r[0] === 11 ? { lungime_masurata: '12.19', observatie: 'măsurat la recepție 12,19 m' } : {})) })
const docCurbe = () => ({ sablon: 'lista_ambalare_curbe', proiect_id: 77, depozit_id: 5,
  antet: antet('TRUCK TEST 1', { total_bucati: '12', total_pachete: '6', total_net_kg: '19,305', total_brut_kg: '19,545' }),
  randuri: CURBE.map(r => randCurba(r, r[0] === 9006 ? { unghi_masurat: '30', decizie: 'primit_neconform', motiv: 'unghi măsurat 30° față de 45° pe listă' } : {})) })

describe('seria', () => {
  it('canonică = expresia coloanei generate E2a (fără spații . _ / -, majuscule)', () => {
    expect(serieCanon(' 999 ts-00.101/ ')).toBe('999TS00101')
    expect(serieCanon(null)).toBe('')
  })
  it('format 999AA99999 + confuziile 5/S 0/O 1/I 8/B în poziția greșită, cu sugestie', () => {
    expect(verificaSerie('999TS00101')).toMatchObject({ formatOk: true, confuzii: [], sugestie: null })
    const r = verificaSerie('999T500210')
    expect(r.formatOk).toBe(false)
    expect(r.confuzii).toEqual([{ poz: 5, gasit: '5', propus: 'S' }])
    expect(r.sugestie).toBe('999TS00210')
    expect(verificaSerie('999TSOO2I0').sugestie).toBe('999TS00210')
    expect(verificaSerie('B99TS00210').sugestie).toBe('899TS00210')
    expect(verificaSerie('12AB').formatOk).toBe(false)
    expect(verificaSerie('12AB').sugestie).toBe(null)
  })
  it('numerele (bend / heat) cu litere confundabile', () => {
    expect(confuziiNumerice('9OO6')).toBe('9006')
    expect(confuziiNumerice('999OOO3')).toBe('9990003')
    expect(confuziiNumerice('9006')).toBe(null)
    expect(confuziiNumerice('TS00011')).toBe(null)
  })
})

describe('numerele (format furnizor și RO)', () => {
  it.each([['12.22', {}, 12.22], ['12,22', {}, 12.22], ['20,318', { mii: true }, 20318], ['20,318', {}, 20.318], ['19 305', { mii: true }, 19305],
    ['1.234,5', {}, 1234.5], ['1,234.5', {}, 1234.5], ['1,342', { mii: true }, 1342], ['1.342', { mii: true }, 1342], ['1342,5', { mii: true }, 1342.5],
    ['8,8', {}, 8.8], ['', {}, null], [null, {}, null], [7.1, {}, 7.1]])('%s %j → %s', (v, o, e) => expect(parseNumar(v, o)).toBe(e))
  it('nenumeric → NaN (nu dispare tăcut)', () => {
    expect(parseNumar('abc')).toBeNaN()
    expect(parseNumar('1,2,3')).toBeNaN()
  })
  it('metri ↔ mm întregi', () => {
    expect(mmDinM('12.22')).toBe(12220)
    expect(mmDinM('6,04')).toBe(6040)
    expect(mDinMm(12190)).toBe('12,19')
    expect(mDinMm(12195)).toBe('12,195')
  })
})

describe('rândul: toleranțe, motiv, intervale', () => {
  const rn = (extra, s = 'aviz_teava') => randNormalizat({ ...randAviz(AVIZ2[10]), ...extra }, s)
  const niv = v => v.map(x => `${x.nivel}:${x.camp}`)
  it('aviz 2 rândul 11: 12,19 măsurat față de 12,22 = 30 mm > ±10 → fără observație e blocant, cu observație e avertisment', () => {
    expect(niv(validareRand(rn({ lungime_masurata: '12.19' }), 'aviz_teava'))).toEqual(expect.arrayContaining(['blocant:observatie', 'avertisment:decizie']))
    const cu = validareRand(rn({ lungime_masurata: '12.19', observatie: 'măsurat 12,19' }), 'aviz_teava')
    expect(cu.filter(x => x.nivel === 'blocant')).toEqual([])
    expect(niv(cu)).toContain('avertisment:lungime_masurata_mm')
  })
  it('la prag exact (10 mm) nu e avertisment; la 11 mm e', () => {
    expect(validareRand(rn({ lungime_masurata: '12.21' }), 'aviz_teava')).toEqual([])
    expect(validareRand(rn({ lungime_masurata: '12.23' }), 'aviz_teava')).toEqual([])
    expect(niv(validareRand(rn({ lungime_masurata: '12.209' }), 'aviz_teava'))).toContain('blocant:observatie')
  })
  it('refuzat / neconform fără motiv → blocant', () => {
    expect(niv(validareRand(rn({ decizie: 'refuzat_la_receptie' }), 'aviz_teava'))).toContain('blocant:motiv')
    expect(niv(validareRand(rn({ decizie: 'primit_neconform' }), 'aviz_teava'))).toContain('blocant:motiv')
    expect(validareRand(rn({ decizie: 'refuzat_la_receptie', motiv: 'fără marcaj vizibil' }), 'aviz_teava')).toEqual([])
  })
  it('lungimea lipsă / în afara 1–30000 mm și numerele invalide → blocant', () => {
    expect(niv(validareRand(rn({ lungime_doc: '' }), 'aviz_teava'))).toContain('blocant:lungime_doc_mm')
    expect(niv(validareRand(rn({ lungime_doc: '31' }), 'aviz_teava'))).toContain('blocant:lungime_doc_mm')
    expect(niv(validareRand(rn({ greutate_kg: '1x' }), 'aviz_teava'))).toContain('blocant:greutate_kg')
  })
  it('seria: format + confuzii = avertisment, lipsă = blocant', () => {
    expect(niv(validareRand(rn({ serie: '999T500216' }), 'aviz_teava'))).toEqual(['avertisment:serie'])
    expect(validareRand(rn({ serie: '999T500216' }), 'aviz_teava')[0].mesaj).toContain('999TS00216')
    expect(niv(validareRand(rn({ serie: 'XYZ' }), 'aviz_teava'))).toEqual(['avertisment:serie'])
    expect(niv(validareRand(rn({ serie: '' }), 'aviz_teava'))).toContain('blocant:serie')
  })
  it('curba 9006: 45° pe listă, 30° măsurat; neconformă cu motiv → doar avertisment; ±0,5° la prag nu e avertisment', () => {
    const c = extra => randNormalizat({ ...randCurba(CURBE[5]), ...extra }, 'lista_ambalare_curbe')
    const v = validareRand(c({ unghi_masurat: '30', decizie: 'primit_neconform', motiv: 'unghi 30°' }), 'lista_ambalare_curbe')
    expect(v.filter(x => x.nivel === 'blocant')).toEqual([])
    expect(niv(v)).toContain('avertisment:unghi_masurat')
    expect(niv(validareRand(c({ unghi_masurat: '30' }), 'lista_ambalare_curbe'))).toContain('blocant:observatie')
    expect(validareRand(c({ unghi_masurat: '45,5' }), 'lista_ambalare_curbe')).toEqual([])
    expect(niv(validareRand(c({ unghi_masurat: '45,6' }), 'lista_ambalare_curbe'))).toContain('blocant:observatie')
    expect(niv(validareRand(c({ unghi_doc: '95' }), 'lista_ambalare_curbe'))).toContain('blocant:unghi_doc')
    expect(niv(validareRand(c({ cantitate: '2' }), 'lista_ambalare_curbe'))).toContain('blocant:cantitate')
  })
  it('codul curbei față de câmpuri', () => {
    const c = extra => randNormalizat({ ...randCurba(CURBE[5]), ...extra }, 'lista_ambalare_curbe')
    expect(verificaCodCurba(c())).toBe(null)
    expect(verificaCodCurba(c({ sarja: '9990004' }))).toContain('heat 9990003')
    expect(verificaCodCurba(c({ perete_mm: '8' }))).toContain('perete 8,8')
  })
})

describe('documentele de test pv_test', () => {
  it('aviz 1: 15 rânduri, Σ 90,75 m și 10 192 kg = totalurile avizului, fără blocante', () => {
    const v = validareDocument(docAviz1())
    expect(v.blocante).toBe(0)
    expect(v.totaluri.comparatii.map(c => [c.cheie, c.calculat, c.bate])).toEqual([['total_m', 90.75, true], ['total_kg', 10192, true]])
    expect(v.totaluri).toMatchObject({ randuri: 15, primit: 15, refuzat: 0, neconform: 0 })
  })
  it('aviz 2: rândul 7 refuzat INCLUS în sumă (180,93 m / 20 318 kg); primit 14 · 168,98 m, cu măsurătoarea 168,95 m', () => {
    const v = validareDocument(docAviz2())
    expect(v.blocante).toBe(0)
    expect(v.totaluri.comparatii.every(c => c.bate)).toBe(true)
    expect(v.totaluri).toMatchObject({ primit: 14, refuzat: 1, m_doc_mm: 180930, m_primit_mm: 168980, m_real_mm: 168950, kg: 20318 })
  })
  it('lista de curbe: 12 buc · 6 pachete · net 19 305 · brut 19 545; 9006 neconformă', () => {
    const v = validareDocument(docCurbe())
    expect(v.blocante).toBe(0)
    expect(v.totaluri.comparatii.map(c => [c.cheie, c.calculat, c.bate])).toEqual([['total_bucati', 12, true], ['total_pachete', 6, true],
      ['total_net_kg', 19305, true], ['total_brut_kg', 19545, true]])
    expect(v.totaluri).toMatchObject({ primit: 11, neconform: 1 })
  })
  it('ținta: 40 de bucăți disponibile · 259,73 m (lungimea de pe document) + 1 curbă în carantină; cu măsurătoarea 259,70 m', () => {
    const r = rezumatRegistru([docAviz1(), docAviz2(), docCurbe()])
    expect(r.disponibile).toEqual({ n: 40, teava: 29, curbe: 11, m_doc: 259.73, m_real: 259.7 })
    expect(r.carantina).toEqual({ n: 1, teava: 0, curbe: 1, m: 0 })
    expect(r.refuzate).toBe(1)
  })
  it('un total greșit pe document → blocant (confirmarea e oprită)', () => {
    const d = docAviz2(); d.antet.total_m = '180.94'
    const v = validareDocument(d)
    expect(v.document.map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:total_m')
    const d2 = docCurbe(); d2.antet.total_net_kg = ''
    expect(validareDocument(d2).document.map(x => x.camp)).toContain('total_net_kg')
    const d3 = docCurbe(); d3.antet.total_brut_kg = ''      // brutul e opțional („dacă e scris”)
    expect(validareDocument(d3).blocante).toBe(0)
  })
  it('dubluri de serie / nr. crt. în același document → blocant; antetul incomplet → blocant', () => {
    const d = docAviz1(); d.randuri[3].serie = '999 TS 00101'; d.randuri[4].nr_crt = '1'
    const v = validareDocument(d)
    expect(v.randuri[3].map(x => x.camp)).toContain('serie')
    expect(v.randuri[4].map(x => x.camp)).toContain('nr_crt')
    const d2 = docAviz1(); d2.antet.furnizor = ''; d2.depozit_id = null
    expect(validareDocument(d2).document.map(x => x.camp)).toEqual(expect.arrayContaining(['furnizor', 'depozit_id']))
  })
  it('salvarea draftului cere doar identitatea, depozitul și numere valide', () => {
    expect(eroriSalvare(docAviz2())).toEqual([])
    const d = docAviz2(); d.antet.nr_document = ''; d.randuri[0].lungime_doc = '12,4x'
    expect(eroriSalvare(d)).toEqual(['Completează nr. documentului.', 'Rândul 1: lungimea de pe document nu e număr.'])
    const d2 = docAviz2(); d2.randuri[0].decizie = 'refuzat_la_receptie'   // fără motiv: se poate salva ca draft
    expect(eroriSalvare(d2)).toEqual([])
  })
})

describe('lipirea din Excel', () => {
  const tsv = rows => rows.map(r => r.join('\t')).join('\r\n')
  it('TSV cu ghilimele (tab / rând nou în celulă)', () => {
    expect(parseTsv('a\t"b\tc"\t"d\ne"\r\n\r\n1\t"x""y"\t\n')).toEqual([['a', 'b\tc', 'd\ne'], ['1', 'x"y', '']])
  })
  it('antetele documentelor reale', () => {
    const a = ['Nr. Crt', 'Nr Teava', 'Specificatia', 'Nr Sarja', 'Nr Lot', 'Cantitate livrata (m)', 'Greutate (kg)', 'L măsurat']
    expect(a.map(h => campDinAntet(h, 'aviz_teava'))).toEqual(['nr_crt', 'serie', 'specificatie', 'sarja', 'lot', 'lungime_doc', 'greutate_kg', 'lungime_masurata'])
    const c = ['BEND NUMBER', 'CODE', 'PIPE HEAT NUMBER', 'ITEM', 'SIZE', 'WALL THICKNESS', 'DESCRIPTION', 'DEGREE', 'SIZE-MATERIAL STD', 'QUANTITY (PCS)',
      'PACKING NO', 'DIMENSIONS CM (WXLXH)', 'NET KG', 'GROSS KG', 'Unghi măsurat']
    expect(c.map(h => campDinAntet(h, 'lista_ambalare_curbe'))).toEqual(['serie', 'cod', 'sarja', 'item', 'diametru_mm', 'perete_mm', 'specificatie', 'unghi_doc',
      'standard', 'cantitate', 'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg', 'unghi_masurat'])
  })
  it('avizul 2 lipit cu antet (format furnizor: 12.48 m, 1,402 kg) + rândul de total sărit → aceleași totaluri', () => {
    const text = tsv([['Nr. Crt', 'Nr Teava', 'Specificatia', 'Nr Sarja', 'Nr Lot', '"Cantitate livrata\n(m)"', 'Greutate (kg)'],
      ...AVIZ2.map(([nr, s, sj, lot, L, kg]) => [nr, s, 'Tevi sudate', sj, lot, L, kg.toLocaleString('en-US')]), ['', 'TOTAL GENERAL', '', '', '', '180.93', '20,318']])
    const r = randuriDinLipire(text, 'aviz_teava')
    expect(r.antet).toBe(true)
    expect(r.ignorate).toBe(1)
    expect(r.randuri).toHaveLength(15)
    expect(r.randuri[0]).toMatchObject({ nr_crt: '1', serie: '999TS00201', sarja: 'TS00021', lot: '911', lungime_doc: '12.48', greutate_kg: '1,402', decizie: 'primit' })
    const t = totaluriDocument('aviz_teava', { total_m: '180.93', total_kg: '20,318' }, r.randuri.map(x => randNormalizat(x, 'aviz_teava')))
    expect(t.comparatii.every(c => c.bate)).toBe(true)
  })
  it('lista de curbe lipită: celulele unite (pachet, dimensiuni) vin goale pe al doilea rând → completate în jos', () => {
    const rows = CURBE.map(([b, cod, h, it, w, d, p, dims, n, g], i) => [b, cod, h, it, 610, w, 'INDUCTION BEND', d, 'EN 14870-1', 1, i % 2 ? '' : p, i % 2 ? '' : dims, n, g])
    const r = randuriDinLipire(tsv([['BEND NUMBER', 'CODE', 'PIPE HEAT NUMBER', 'ITEM', 'SIZE', 'WALL THICKNESS', 'DESCRIPTION', 'DEGREE', 'SIZE-MATERIAL STD',
      'QUANTITY (PCS)', 'PACKING NO', 'DIMENSIONS CM (WXLXH)', 'NET KG', 'GROSS KG'], ...rows]), 'lista_ambalare_curbe')
    expect(r.randuri).toHaveLength(12)
    expect(r.randuri[5]).toMatchObject({ serie: '9006', sarja: '9990003', pachet_nr: '3', dimensiuni_cm: '455X80X150', unghi_doc: '45', perete_mm: '8,8', nr_crt: '6' })
    const t = totaluriDocument('lista_ambalare_curbe', { total_bucati: '12', total_pachete: '6', total_net_kg: '19305', total_brut_kg: '19545' },
      r.randuri.map(x => randNormalizat(x, 'lista_ambalare_curbe')))
    expect(t.comparatii.every(c => c.bate)).toBe(true)
  })
  it('fără antet: ordinea documentului (7 coloane) sau cea scurtă; nr. crt. continuă de la nrStart', () => {
    const lung = randuriDinLipire(tsv(AVIZ1.slice(0, 2).map(([nr, s, sj, lot, L, kg]) => [nr, s, 'spec', sj, lot, L, kg])), 'aviz_teava')
    expect(lung.antet).toBe(false)
    expect(lung.randuri[1]).toMatchObject({ nr_crt: '2', serie: '999TS00102', sarja: 'TS00011', lungime_doc: '6.11', greutate_kg: '686' })
    const scurt = randuriDinLipire('999TS00101\tTS00011\t901\t6,04\t678\n999TS00102\tTS00011\t901\t6,11\t686', 'aviz_teava', { nrStart: 16 })
    expect(scurt.randuri.map(x => [x.nr_crt, x.serie, x.lungime_doc])).toEqual([['16', '999TS00101', '6,04'], ['17', '999TS00102', '6,11']])
  })
})

describe('argumentele RPC (design r4)', () => {
  it('salvare document nou: p_doc_id / p_versiune NULL, totaluri numerice, lungimi în mm întregi, fără bucata_id', () => {
    const a = argumenteSalveaza(docAviz2())
    expect(a.p_doc_id).toBe(null)
    expect(a.p_versiune).toBe(null)
    expect(a.p_antet).toMatchObject({ proiect_id: 77, depozit_id: 5, sablon: 'aviz_teava', furnizor: 'FURNIZOR TEST SRL', nr_document: 'TEST-2610222',
      data_document: '2026-10-22', total_m: 180.93, total_kg: 20318, scanuri: [] })
    expect(a.p_randuri[10]).toMatchObject({ nr_crt: 11, serie: '999TS00216', lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372, perete_mm: 7.1, decizie: 'primit' })
    expect(a.p_randuri[6]).toMatchObject({ decizie: 'refuzat_la_receptie', motiv: 'fără marcaj vizibil' })
    expect(a.p_randuri.some(r => 'bucata_id' in r || 'unghi_doc' in r)).toBe(false)
  })
  it('editare: CAS pe versiune; curbele fără câmpuri de țeavă; manifestul scanurilor în p_antet', () => {
    const d = { ...docCurbe(), id: 12, versiune: 4, scanuri: [{ cale: '12/abc.pdf', sha256_original: 'a', sha256_pdf: 'b', marime: 10, mime: 'application/pdf', alt: 1 }] }
    const a = argumenteSalveaza(d)
    expect([a.p_doc_id, a.p_versiune]).toEqual([12, 4])
    expect(a.p_antet).toMatchObject({ total_bucati: 12, total_pachete: 6, total_net_kg: 19305, total_brut_kg: 19545 })
    expect(a.p_antet.scanuri).toEqual([{ cale: '12/abc.pdf', sha256_original: 'a', sha256_pdf: 'b', marime: 10, mime: 'application/pdf' }])
    expect(a.p_randuri[5]).toMatchObject({ serie: '9006', sarja: '9990003', unghi_doc: 45, unghi_masurat: 30, decizie: 'primit_neconform', cantitate: 1, net_kg: 1799 })
    expect('lungime_doc_mm' in a.p_randuri[0]).toBe(false)
  })
  it('confirmare și PV', () => {
    expect(argumenteConfirma(12, { versiune: 5, hash: 'e3-doc-v1:ab' })).toEqual({ p_doc_id: 12, p_versiune: 5, p_hash: 'e3-doc-v1:ab' })
    expect(argumentePv({ id: 12, versiune: 6 }, ' PV 14 ', '2026-10-23')).toEqual({ p_doc_id: 12, p_versiune: 6, p_pv_nr: 'PV 14', p_pv_data: '2026-10-23' })
  })
  it('verificarea: „ok” doar cu verdict bun, zero blocante, hash și versiune (fail-closed)', () => {
    expect(normalizeazaVerificare({ versiune: 5, hash: 'h', verdict: 'ok', avertismente: ['format'] })).toMatchObject({ ok: true, blocante: 0, lista: [{ mesaj: 'format', blocant: false }] })
    expect(normalizeazaVerificare([{ versiune: 5, hash: 'h', verdict: 'ok', avertismente: [] }]).ok).toBe(true)
    expect(normalizeazaVerificare({ versiune: 5, hash: 'h', verdict: 'ok', avertismente: [{ nr_crt: 7, mesaj: 'sumă', nivel: 'blocant' }] })).toMatchObject({ ok: false, blocante: 1 })
    expect(normalizeazaVerificare({ versiune: 5, hash: 'h', verdict: 'ok', blocante: ['totaluri'] }).ok).toBe(false)
    expect(normalizeazaVerificare({ versiune: 5, hash: 'h', verdict: 'blocat', avertismente: [] }).ok).toBe(false)
    expect(normalizeazaVerificare({ versiune: 5, hash: null, verdict: 'ok' }).ok).toBe(false)
    expect(normalizeazaVerificare(null).ok).toBe(false)
  })
})

describe('erori și drepturi', () => {
  it('„în pregătire” doar când lipsește un obiect E3 / E2a numit', () => {
    expect(lipsaReceptie({ code: 'PGRST202', message: 'Could not find the function public.fn_izo_doc_verifica(p_doc_id) in the schema cache' })).toBe(true)
    expect(lipsaReceptie({ code: '42P01', message: 'relation "public.izo_documente_intrare" does not exist' })).toBe(true)
    expect(lipsaReceptie({ code: 'PGRST205', message: "Could not find the table 'public.izo_documente_intrare_randuri' in the schema cache" })).toBe(true)
    expect(lipsaReceptie({ code: '42883', message: 'function public.fn_izo_doc_pv(bigint, bigint, text, date) does not exist' })).toBe(true)
    expect(lipsaReceptie({ code: '42501', message: 'permission denied for table izo_documente_intrare' })).toBe(false)
    expect(lipsaReceptie({ code: '42703', message: 'column izo_documente_intrare.pv_nr does not exist' })).toBe(false)
    expect(lipsaReceptie({ code: 'PGRST202', message: 'Could not find the function public.fn_alta' })).toBe(false)
    expect(lipsaReceptie(null)).toBe(false)
  })
  it('mesajele', () => {
    expect(mesajEroareDoc({ code: '40001', message: 'x' })).toContain('Verifică')
    expect(mesajEroareDoc({ code: '23505', message: 'duplicate key value violates unique constraint "ux_izo_doc_identitate"' })).toContain('același furnizor')
    expect(mesajEroareDoc({ code: '23505', message: 'seria 999TS00216 (rândul 11) a fost înregistrată între timp de alt document' })).toContain('999TS00216')
    expect(mesajEroareDoc({ code: '42501', message: 'nope' })).toContain('gestionar')
    expect(mesajEroareDoc({ code: 'P0001', message: 'alt mesaj' })).toBe('alt mesaj')
  })
  it('dreptul de scriere în UI: owner, sau gestionar pe (proiect, depozit) + Magazie editor', () => {
    const a = [{ proiect_id: 77, depozit_id: 5, rol: 'gestionar', activ: true, valabil_de: '2026-10-01', valabil_pana: null }]
    const p = o => poateScrie({ owner: false, nivelMagazie: 'editor', atribuiri: a, proiectId: 77, depozitId: 5, azi: '2026-10-21', ...o })
    expect(p({})).toBe(true)
    expect(p({ owner: true, nivelMagazie: null, atribuiri: [] })).toBe(true)
    expect(p({ nivelMagazie: 'viewer' })).toBe(false)
    expect(p({ depozitId: 6 })).toBe(false)
    expect(p({ proiectId: 78 })).toBe(false)
    expect(p({ azi: '2026-09-30' })).toBe(false)
    expect(p({ atribuiri: [{ ...a[0], valabil_pana: '2026-10-20' }] })).toBe(false)
    expect(p({ atribuiri: [{ ...a[0], rol: 'inginer_izometrie' }] })).toBe(false)
  })
})

describe('încărcarea din BD și hash-ul', () => {
  it('rândul și antetul din BD → editor (dus-întors cu argumentele de salvare)', () => {
    const r = randDinBd({ nr_crt: 11, serie: '999TS00216', sarja: 'TS00023', lot: '912', lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372, perete_mm: 7.1,
      diametru_mm: 610, decizie: 'primit', observatie: 'măsurat', bucata_id: 901 })
    expect(r).toMatchObject({ nr_crt: '11', lungime_doc: '12,22', lungime_masurata: '12,19', greutate_kg: '1372', perete_mm: '7,1', bucata_id: 901 })
    expect(randDinBd({ nr_crt: 1, serie: 'x', lungime_doc_m: 6.04 }).lungime_doc).toBe('6,04')
    const a = antetDinBd({ furnizor_canon: 'FURNIZOR TEST SRL', nr_document_canon: 'TEST-2610222', data_document: '2026-10-22T00:00:00', total_m: 180.93, total_kg: 20318 })
    expect(a).toMatchObject({ furnizor: 'FURNIZOR TEST SRL', nr_document: 'TEST-2610222', data_document: '2026-10-22', total_m: '180,93', total_kg: '20318' })
    const d = { sablon: 'aviz_teava', proiect_id: 77, depozit_id: 5, id: 3, versiune: 2, antet: a, randuri: [r] }
    expect(argumenteSalveaza(d).p_antet).toMatchObject({ total_m: 180.93, total_kg: 20318 })
    expect(argumenteSalveaza(d).p_randuri[0]).toMatchObject({ lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372 })
  })
  it('sha256 hex (declarat de client până la E9)', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})
