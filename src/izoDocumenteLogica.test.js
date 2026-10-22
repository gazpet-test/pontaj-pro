import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  serieCanon, verificaSerie, confuziiNumerice, parseNumar, mmDinM, mDinMm, fmtM, randGol, randNormalizat, validareRand, validareDocument,
  totaluriDocument, eroriSalvare, eroriPv, eroareMotiv, rezumatRegistru, parseTsv, campDinAntet, decizieDinText, izolatieDinText, randuriDinLipire,
  argumenteSalveaza, argumenteConfirma, argumentePv, argumenteAnuleazaDraft, randPentruRpc, manifestScan, cheieDubluraRand,
  normalizeazaSalvare, normalizeazaVerificare, normalizeazaConfirmare, normalizeazaPv, normalizeazaAnulare, lipsaReceptie, mesajEroareDoc,
  poateScrie, verificaCodCurba, randDinBd, antetDinBd, sha256Hex, SABLOANE, COLOANE, CHEI_ANTET, CHEI_RAND, CHEI_SCAN, BUCKET_SCANURI,
  MAX_SCAN_OCTETI, RE_CALE_SCAN, caleScan, pregatesteScan, urcaScan, stergeScanObiect, linkScan, eroareDefinitivaRpc, ataseazaScanSigur,
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
    const d2 = docCurbe(); d2.antet.total_net_kg = ''      // ca serverul: verificat doar dacă e scris → avertisment, nu blocant
    expect(validareDocument(d2).document.map(x => `${x.nivel}:${x.camp}`)).toContain('avertisment:total_net_kg')
    expect(validareDocument(d2).blocante).toBe(0)
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

// ── contractul RPC E3 (21.10.2026): fixture-uri de scan cu UUID v4 și hash-uri de 64 hex ─────────────────────────
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64)
const UUID1 = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f', UUID2 = '9e8d7c6b-5a49-4382-a716-152433425160'
const scan = (doc, uuid, extra = {}) => ({ id: 1, document_id: doc, cale: `${doc}/${uuid}.pdf`, sha256_original: H1, sha256_pdf: H2, marime: 2048, mime: 'application/pdf', adaugat_la: '2026-10-21', ...extra })
const chei = o => Object.keys(o).sort()

describe('argumentele RPC — chei exacte (liste închise)', () => {
  it('SABLOANE (antet + totaluri) = cheile de șablon ale contractului', () => {
    for (const s of ['aviz_teava', 'lista_ambalare_curbe']) {
      expect([...SABLOANE[s].antet, ...SABLOANE[s].totaluri].map(x => x[0]).sort()).toEqual([...CHEI_ANTET[s]].sort())
    }
  })
  it('creare: p_doc_id / p_versiune NULL, cinci argumente, p_antet = creare (fără înlocuire) + comune + șablon, p_scanuri NULL', () => {
    for (const d of [docAviz2(), docCurbe()]) {
      const a = argumenteSalveaza(d)
      expect(chei(a)).toEqual(['p_antet', 'p_doc_id', 'p_randuri', 'p_scanuri', 'p_versiune'])
      expect([a.p_doc_id, a.p_versiune, a.p_scanuri]).toEqual([null, null, null])
      expect(chei(a.p_antet)).toEqual(['proiect_id', 'depozit_id', 'sablon', ...CHEI_ANTET.comune, ...CHEI_ANTET[d.sablon]].sort())
      for (const r of a.p_randuri) expect(chei(r)).toEqual([...CHEI_RAND.comune, ...CHEI_RAND[d.sablon]].sort())
    }
    const a = argumenteSalveaza(docAviz2())
    expect(a.p_antet).toMatchObject({ proiect_id: 77, depozit_id: 5, sablon: 'aviz_teava', furnizor: 'FURNIZOR TEST SRL', nr_document: 'TEST-2610222',
      data_document: '2026-10-22', total_m: 180.93, total_kg: 20318, observatii: null })
    expect(a.p_randuri[10]).toMatchObject({ nr_crt: 11, serie: '999TS00216', lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372, perete_mm: 7.1,
      diametru_mm: 610, decizie: 'primit', standard: null, izolatie: null })
    expect(a.p_randuri[6]).toMatchObject({ decizie: 'refuzat_la_receptie', motiv: 'fără marcaj vizibil' })
  })
  it('editare: CAS pe versiune, FĂRĂ cheile de identitate / creare; curbele fără câmpuri de țeavă', () => {
    const a = argumenteSalveaza({ ...docCurbe(), id: 12, versiune: 4, inlocuieste_document_id: 3, motiv_inlocuire: 'x' })
    expect([a.p_doc_id, a.p_versiune, a.p_scanuri]).toEqual([12, 4, null])
    for (const k of CHEI_ANTET.creare) expect(k in a.p_antet).toBe(false)
    expect(chei(a.p_antet)).toEqual([...CHEI_ANTET.comune, ...CHEI_ANTET.lista_ambalare_curbe].sort())
    expect(a.p_antet).toMatchObject({ total_bucati: 12, total_pachete: 6, total_net_kg: 19305, total_brut_kg: 19545 })
    expect(a.p_randuri[5]).toMatchObject({ serie: '9006', sarja: '9990003', unghi_doc: 45, unghi_masurat: 30, decizie: 'primit_neconform', cantitate: 1, net_kg: 1799,
      standard: 'EN 14870-1', lot: null, greutate_kg: null })
    expect('lungime_doc_mm' in a.p_randuri[0]).toBe(false)
    expect(a.p_randuri.some(r => 'bucata_id' in r || 'serie_canon' in r)).toBe(false)
  })
  it('manifestul scanurilor: null = neschimbat (implicit), listă = manifestul întreg cu EXACT 5 chei, [] = golire', () => {
    const d = { ...docAviz1(), id: 12, versiune: 4, scanuri: [scan(12, UUID1)] }
    expect(argumenteSalveaza(d).p_scanuri).toBe(null)
    const a = argumenteSalveaza(d, { scanuri: [...d.scanuri, { ...scan(12, UUID2), pdf: new Blob(['x']), nume: 'aviz.jpg' }] })
    expect(a.p_scanuri).toEqual([{ cale: `12/${UUID1}.pdf`, sha256_original: H1, sha256_pdf: H2, marime: 2048, mime: 'application/pdf' },
      { cale: `12/${UUID2}.pdf`, sha256_original: H1, sha256_pdf: H2, marime: 2048, mime: 'application/pdf' }])
    for (const x of a.p_scanuri) { expect(chei(x)).toEqual([...CHEI_SCAN].sort()); expect(x.cale).toMatch(RE_CALE_SCAN) }
    expect('scanuri' in a.p_antet).toBe(false)
    expect(argumenteSalveaza(d, { scanuri: [] }).p_scanuri).toEqual([])
    expect(manifestScan({ ...scan(12, UUID1), marime: '2048' }).marime).toBe(2048)
  })
  it('motiv_inlocuire: obligatoriu (3–1000) când există inlocuieste_document_id; trimis DOAR la creare, împreună cu ținta', () => {
    const d = { ...docAviz1(), inlocuieste_document_id: '9', motiv_inlocuire: '  nr. aviz greșit  ' }
    expect(argumenteSalveaza(d).p_antet).toMatchObject({ inlocuieste_document_id: 9, motiv_inlocuire: 'nr. aviz greșit' })
    expect(eroriSalvare(d)).toEqual([])
    expect(eroriSalvare({ ...d, motiv_inlocuire: ' ab ' })).toEqual(['Scrie motivul înlocuirii (cel puțin 3 caractere).'])
    expect(eroriSalvare({ ...d, motiv_inlocuire: 'x'.repeat(1001) })[0]).toContain('peste 1000')
    expect(validareDocument({ ...d, motiv_inlocuire: '' }).document.map(x => x.camp)).toContain('motiv_inlocuire')
    const fara = argumenteSalveaza({ ...docAviz1(), motiv_inlocuire: 'ceva' })
    expect('inlocuieste_document_id' in fara.p_antet || 'motiv_inlocuire' in fara.p_antet).toBe(false)
    expect(eroriSalvare({ ...d, id: 4, versiune: 2, motiv_inlocuire: '' })).toEqual([])   // la editare înlocuirea nu se mai trimite
  })
  it('câmpurile comune ale rândului se păstrează dus-întors BD → editor → RPC (rândurile se înlocuiesc integral)', () => {
    const bdT = { nr_crt: 3, serie: '999TS00103', sarja: 'TS00011', lot: '901', specificatie: 'Tevi sudate', dimensiune: '610x7,1', grad_otel: 'L360NE',
      standard: 'EN 10208-2', izolatie: 'PEHD', diametru_mm: 610, perete_mm: 7.1, greutate_kg: 672.5, lungime_doc_mm: 5980, lungime_masurata_mm: 5975,
      decizie: 'primit_neconform', motiv: 'izolație lovită', observatie: 'la capătul B', bucata_id: null }
    const rT = argumenteSalveaza({ sablon: 'aviz_teava', id: 3, versiune: 2, depozit_id: 5, antet: {}, randuri: [randDinBd(bdT)] }).p_randuri[0]
    expect(rT).toEqual(Object.fromEntries([...CHEI_RAND.comune, ...CHEI_RAND.aviz_teava].map(k => [k, bdT[k]])))
    const bdC = { nr_crt: 6, serie: '9006', sarja: '9990003', lot: 'L2', specificatie: 'INDUCTION BEND', dimensiune: '610x8,8', grad_otel: 'L360NE', standard: 'EN 14870-1',
      izolatie: 'GRP', diametru_mm: 610, perete_mm: 8.8, greutate_kg: 1800.5, cod: '9006-610-8,8-45-6100-9990003-3', item: '3', unghi_doc: 45, unghi_masurat: 45.5,
      cantitate: 1, pachet_nr: '3', dimensiuni_cm: '455X80X150', net_kg: 1799, brut_kg: 1819, decizie: 'primit', motiv: null, observatie: null }
    const rC = argumenteSalveaza({ sablon: 'lista_ambalare_curbe', id: 4, versiune: 2, depozit_id: 5, antet: {}, randuri: [randDinBd(bdC)] }).p_randuri[0]
    expect(rC).toEqual(Object.fromEntries([...CHEI_RAND.comune, ...CHEI_RAND.lista_ambalare_curbe].map(k => [k, bdC[k]])))
  })
  it('observatii (antet comun): citit din BD, trimis la salvare; antetul fără aliasuri istorice', () => {
    const a = antetDinBd({ furnizor: 'F', nr_document: 'N', data_document: '2026-10-22T00:00:00', observatii: 'camion sosit cu întârziere', total_m: 90.75, cumparator: 'GAZPET' })
    expect(a).toMatchObject({ observatii: 'camion sosit cu întârziere', data_document: '2026-10-22', total_m: '90,75', cumparator: 'GAZPET', factura: '' })
    expect(argumenteSalveaza({ sablon: 'aviz_teava', id: 1, versiune: 1, antet: a, randuri: [] }).p_antet).toMatchObject({ observatii: 'camion sosit cu întârziere', total_m: 90.75 })
    expect(antetDinBd({ furnizor_canon: 'X' }).furnizor).toBe('')
  })
  it('decizia invalidă nu pleacă niciodată spre server (serverul ar pune „primit”)', () => {
    expect(() => randPentruRpc(randNormalizat({ ...randAviz(AVIZ1[0]), decizie: '' }, 'aviz_teava'), 'aviz_teava')).toThrow(/decizie/)
    const d = docAviz1(); d.randuri[2].decizie = ''
    expect(eroriSalvare(d)).toContain('Rândul 3: alege decizia (primit / neconform / refuzat).')
  })
  it('confirmare cu versiunea + hash-ul verificării; PV; anularea ciornei', () => {
    expect(argumenteConfirma(12, { versiune: 5, hash: 'e3-doc-v1:ab' })).toEqual({ p_doc_id: 12, p_versiune: 5, p_hash: 'e3-doc-v1:ab' })
    expect(argumentePv({ id: 12, versiune: 6 }, ' PV 14 ', '2026-10-23')).toEqual({ p_doc_id: 12, p_versiune: 6, p_pv_nr: 'PV 14', p_pv_data: '2026-10-23' })
    expect(argumenteAnuleazaDraft({ id: '12', versiune: '3' }, '  dublură introdusă din greșeală ')).toEqual({ p_doc_id: 12, p_versiune: 3, p_motiv: 'dublură introdusă din greșeală' })
    expect(eroareMotiv('ab', 'motivul anulării')).toBe('Scrie motivul anulării (cel puțin 3 caractere).')
    expect(eroareMotiv('abc')).toBe(null)
    expect(eroriPv(' ', '2026-10-23')).toEqual(['Completează numărul PV-ului.'])
    expect(eroriPv('PV|1', '')).toEqual(['Numărul PV-ului nu poate conține „|”.', 'Completează data PV-ului.'])
    expect(eroriPv('PV 14', '2026-10-23')).toEqual([])
  })
})

describe('răspunsurile RPC (forma din contract + documentul cerut)', () => {
  const V = { document_id: 12, versiune: 5, hash: 'e3-doc-v1:' + 'c'.repeat(64), ok: true, blocante: [], avertismente: [] }
  it('verificarea: ok doar cu ok === true, zero blocante, forma completă și același document', () => {
    expect(normalizeazaVerificare(V, 12)).toMatchObject({ ok: true, document_id: 12, versiune: 5, hash: V.hash, blocante: [], avertismente: [], eroare: null })
    expect(normalizeazaVerificare([V], 12).ok).toBe(true)
    const av = normalizeazaVerificare({ ...V, avertismente: [{ nr_crt: 11, cod: 'toleranta_lungime', mesaj: 'măsurat 12190 mm' }, { nr_crt: null, cod: 'fara_scan', mesaj: 'fără scan' }] }, 12)
    expect(av.ok).toBe(true)
    expect(av.avertismente).toEqual([{ nr_crt: 11, cod: 'toleranta_lungime', mesaj: 'măsurat 12190 mm' }, { nr_crt: null, cod: 'fara_scan', mesaj: 'fără scan' }])
    const bl = normalizeazaVerificare({ ...V, ok: false, blocante: [{ nr_crt: null, cod: 'total_m', mesaj: 'total m ≠' }] }, 12)
    expect(bl).toMatchObject({ ok: false, blocante: [{ nr_crt: null, cod: 'total_m', mesaj: 'total m ≠' }], eroare: null })
    expect(normalizeazaVerificare({ ...V, blocante: [{ nr_crt: 3, cod: 'x', mesaj: 'y' }] }, 12).ok).toBe(false)   // ok:true dar cu blocante → oprit
    expect(normalizeazaVerificare({ ...V, ok: 'true' }, 12)).toMatchObject({ ok: false, eroare: expect.stringContaining('ok') })
    expect(normalizeazaVerificare({ ...V, verdict: 'ok', ok: undefined }, 12).ok).toBe(false)
    expect(normalizeazaVerificare({ ...V, blocante: undefined }, 12).eroare).toContain('blocante')
    expect(normalizeazaVerificare({ ...V, hash: null }, 12).eroare).toContain('hash')
    expect(normalizeazaVerificare({ ...V, document_id: 13 }, 12)).toMatchObject({ ok: false, eroare: expect.stringContaining('alt document') })
    expect(normalizeazaVerificare({ ...V, document_id: undefined }, 12).eroare).toContain('document_id')
    expect(normalizeazaVerificare(null, 12).ok).toBe(false)
  })
  it('salvare / confirmare / PV / anulare: documentul întors trebuie să fie cel cerut, fără fallback pe id-ul local', () => {
    expect(normalizeazaSalvare({ document_id: 31, versiune: 1, hash: 'h' })).toEqual({ document_id: 31, versiune: 1, hash: 'h' })
    expect(() => normalizeazaSalvare({ id: 31, versiune: 1, hash: 'h' })).toThrow(/document_id/)
    expect(() => normalizeazaSalvare({ document_id: 31, versiune: 2, hash: 'h' }, 30)).toThrow(/alt document/)
    expect(() => normalizeazaSalvare({ document_id: 31, versiune: null, hash: 'h' }, 31)).toThrow(/versiunea/)
    const c = normalizeazaConfirmare({ document_id: 12, eveniment_id: 900, bucati: [1, 2], avertismente: [{ nr_crt: null, cod: 'fara_scan', mesaj: 'fără scan' }], versiune: 6, idempotent: false }, 12)
    expect(c).toMatchObject({ bucati: [1, 2], versiune: 6, idempotent: false, avertismente: [{ cod: 'fara_scan' }] })
    expect(() => normalizeazaConfirmare({ document_id: 12, versiune: 6 }, 12)).toThrow(/bucăților/)
    expect(normalizeazaPv({ document_id: 12, eveniment_pv_id: 901, bucati_receptionate: 14, avertismente: [], versiune: 7, idempotent: true }, 12))
      .toMatchObject({ bucati_receptionate: 14, idempotent: true, avertismente: [] })
    expect(() => normalizeazaPv({ document_id: 12, versiune: 7 }, 12)).toThrow(/recepționate/)
    expect(normalizeazaAnulare({ document_id: 12, versiune: 4, stare: 'anulat' }, 12)).toEqual({ document_id: 12, versiune: 4, stare: 'anulat' })
    expect(() => normalizeazaAnulare({ document_id: 12, versiune: 4, stare: 'draft' }, 12)).toThrow(/starea/)
  })
})

// cantitatea 1 și dublura cu unghi sunt regulile convenite pentru E3; la 20261103b @1d8e46e4 serverul încă nu le impune identic
// (cantitate doar > 0; dublura de curbă fără unghi) — vezi comentariile din izoDocumenteLogica.js
describe('regulile E3 oglindite local (contractul de rând)', () => {
  const c = (extra, base = CURBE[5]) => randNormalizat({ ...randCurba(base), ...extra }, 'lista_ambalare_curbe')
  it('curba: cantitatea exact 1 (gol = 1) — blocant la confirmare și la salvare', () => {
    expect(c({ cantitate: '' }).cantitate).toBe(1)
    expect(validareRand(c({ cantitate: '2' }), 'lista_ambalare_curbe').map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:cantitate')
    const d = docCurbe(); d.randuri[0].cantitate = '2'
    expect(eroriSalvare(d)).toContain('Rândul 1: o curbă pe rând (cantitatea 1).')
    expect(eroriSalvare(docCurbe())).toEqual([])
  })
  it('dublura de curbă în document = serie + șarjă + unghi (aceeași serie + șarjă cu alt unghi e legitimă)', () => {
    const d = docCurbe()
    d.randuri[1] = { ...d.randuri[1], serie: '9001', sarja: '9990001', unghi_doc: '12' }   // ca 9001 / 9990001, dar 12° (9001 are 5°)
    expect(validareDocument(d).randuri[1].filter(x => x.camp === 'serie' && x.nivel === 'blocant')).toEqual([])
    d.randuri[1].unghi_doc = '5'
    const v = validareDocument(d).randuri[1].filter(x => x.camp === 'serie' && x.nivel === 'blocant')
    expect(v).toHaveLength(1)
    expect(v[0].mesaj).toContain('9001 / șarja 9990001 / 5°')
    d.randuri[1] = { ...d.randuri[1], unghi_doc: '12', unghi_masurat: '5' }               // unghiul din registru = cel măsurat
    expect(validareDocument(d).randuri[1].some(x => x.camp === 'serie' && x.nivel === 'blocant')).toBe(true)
    d.randuri[1] = { ...d.randuri[1], unghi_masurat: '', sarja: '9990009' }             // altă șarjă → legitimă
    expect(validareDocument(d).randuri[1].some(x => x.camp === 'serie' && x.nivel === 'blocant')).toBe(false)
    expect(cheieDubluraRand(c({}), 'lista_ambalare_curbe')).toBe(JSON.stringify(['9006', '9990003', 45]))
    expect(cheieDubluraRand(randNormalizat(randAviz(AVIZ1[0]), 'aviz_teava'), 'aviz_teava')).toBe('999TS00101')
  })
  it('țeava: dublura rămâne pe serie (canonică)', () => {
    const d = docAviz1(); d.randuri[3].serie = '999 TS 00101'
    expect(validareDocument(d).randuri[3].map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:serie')
  })
  it('lungimile pleacă în mm întregi (sub-milimetrul se rotunjește); afișarea în metri cu 3 zecimale când mm contează', () => {
    expect(mmDinM('6.0004')).toBe(6000)
    expect(mmDinM('12,2196')).toBe(12220)
    expect(mmDinM('6,001')).toBe(6001)
    const r = randPentruRpc(randNormalizat({ ...randAviz(AVIZ1[0]), lungime_doc: '6,0015', lungime_masurata: '6.0004' }, 'aviz_teava'), 'aviz_teava')
    expect([r.lungime_doc_mm, r.lungime_masurata_mm]).toEqual([6002, 6000])
    expect(Number.isInteger(r.lungime_doc_mm) && Number.isInteger(r.lungime_masurata_mm)).toBe(true)
    expect(fmtM(90.75)).toBe('90,75')
    expect(fmtM(90.755)).toBe('90,755')
    expect(fmtM(null)).toBe('—')
  })
  it('precizia: diametru întreg, perete / unghi cu o zecimală — blocant (nu rotunjit tăcut)', () => {
    const r = x => randNormalizat({ ...randAviz(AVIZ1[0]), ...x }, 'aviz_teava')
    expect(validareRand(r({ diametru_mm: '610.5' }), 'aviz_teava').map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:diametru_mm')
    expect(validareRand(r({ perete_mm: '7.15' }), 'aviz_teava').map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:perete_mm')
    expect(validareRand(r({ perete_mm: '7,1', diametru_mm: '610' }), 'aviz_teava')).toEqual([])
    const d = docAviz1(); d.randuri[0].diametru_mm = '610.5'; d.randuri[1].perete_mm = '7.15'
    expect(eroriSalvare(d)).toEqual(['Rândul 1: diametrul se scrie în mm întregi.', 'Rândul 2: peretele are cel mult o zecimală (ex. 7,1).'])
    const dc = docCurbe(); dc.randuri[0].unghi_doc = '5,25'
    expect(eroriSalvare(dc)).toEqual(['Rândul 1: unghiul de pe listă are cel mult o zecimală.'])
    expect(randPentruRpc(r({ perete_mm: '7,1', diametru_mm: '610' }), 'aviz_teava')).toMatchObject({ perete_mm: 7.1, diametru_mm: 610 })
  })
  it('izolația: neizolată / PEHD / GRP (sau gol); altceva blochează salvarea', () => {
    expect([izolatieDinText('pehd'), izolatieDinText('PE-HD'), izolatieDinText('Neizolată'), izolatieDinText('grp'), izolatieDinText(''), izolatieDinText('izolata'), izolatieDinText('bitum')])
      .toEqual(['PEHD', 'PEHD', 'neizolata', 'GRP', null, 'PEHD', 'bitum'])
    const d = docAviz1(); d.randuri[0].izolatie = 'bitum'
    expect(eroriSalvare(d)).toEqual(['Rândul 1: izolația „bitum” nu e recunoscută (neizolată / PEHD / GRP).'])
    d.randuri[0].izolatie = 'PEHD'
    expect(eroriSalvare(d)).toEqual([])
  })
  it('seria e obligatorie și la salvare; totalurile întregi ale listei', () => {
    const d = docAviz1(); d.randuri[0].serie = ' '
    expect(eroriSalvare(d)).toEqual(['Rândul 1: lipsește seria țevii.'])
    const dc = docCurbe(); dc.antet.total_bucati = '12,5'
    expect(eroriSalvare(dc)).toEqual(['„Total bucăți” trebuie să fie număr întreg.'])
  })
  it('„+ Rând” nu preia șarja / lotul (trasabilitate), doar constantele fizice', () => {
    const r = randGol('aviz_teava', 2, randAviz(AVIZ1[0], { izolatie: 'PEHD' }))
    expect(r).toMatchObject({ sarja: '', lot: '', perete_mm: '7,1', diametru_mm: '610', izolatie: 'PEHD' })
  })
})

describe('lipirea: decizia fail-closed și antetele proprii', () => {
  it('decizia din Excel: doar textele cunoscute; „NU” / „x” rămân de ales (blocant)', () => {
    expect(['Respins', 'refuzat', 'NU', 'x', 'Primit', 'primit conform', 'OK', 'Neconform → carantină', 'carantina', 'primit_neconform', ''].map(decizieDinText))
      .toEqual(['refuzat_la_receptie', 'refuzat_la_receptie', '', '', 'primit', 'primit', 'primit', 'primit_neconform', 'primit_neconform', 'primit_neconform', ''])
    const r = randuriDinLipire('Nr Teava\tL aviz (m)\tDecizie\n999TS00101\t6,04\tNU\n999TS00102\t6,11\tRespins', 'aviz_teava')
    expect(r.randuri.map(x => x.decizie)).toEqual(['', 'refuzat_la_receptie'])
    expect(validareRand(randNormalizat(r.randuri[0], 'aviz_teava'), 'aviz_teava').map(x => `${x.nivel}:${x.camp}`)).toContain('blocant:decizie')
  })
  it('fiecare etichetă de coloană a ecranului → câmpul ei (dus-întors cu „Copiază” din tabel)', () => {
    for (const s of ['aviz_teava', 'lista_ambalare_curbe']) for (const [camp, et] of COLOANE[s]) expect([s, et, campDinAntet(et, s)]).toEqual([s, et, camp])
    for (const [et, camp] of [['Decizie', 'decizie'], ['Motiv', 'motiv'], ['Observație', 'observatie']]) expect(campDinAntet(et, 'aviz_teava')).toBe(camp)
  })
  it('izolația lipită se aduce la cheia contractului', () => {
    const r = randuriDinLipire('Nr Teava\tL aviz (m)\tIzolatie\n999TS00101\t6,04\tpe-hd', 'aviz_teava')
    expect(r.randuri[0].izolatie).toBe('PEHD')
  })
})

describe('erori și drepturi', () => {
  it('„în pregătire” doar când lipsește un obiect E3 / E2a numit (nu la nepotrivirea de argumente)', () => {
    expect(lipsaReceptie({ code: 'PGRST202', message: 'Could not find the function public.fn_izo_doc_verifica(p_doc_id) in the schema cache' })).toBe(true)
    expect(lipsaReceptie({ code: '42P01', message: 'relation "public.izo_documente_intrare" does not exist' })).toBe(true)
    expect(lipsaReceptie({ code: 'PGRST205', message: "Could not find the table 'public.izo_documente_intrare_randuri' in the schema cache" })).toBe(true)
    expect(lipsaReceptie({ code: '42883', message: 'function public.fn_izo_doc_pv(bigint, bigint, text, date) does not exist' })).toBe(true)
    expect(lipsaReceptie({ code: '42501', message: 'permission denied for table izo_documente_intrare' })).toBe(false)
    expect(lipsaReceptie({ code: '42703', message: 'column izo_documente_intrare.pv_nr does not exist' })).toBe(false)
    expect(lipsaReceptie({ code: 'PGRST202', message: 'Could not find the function public.fn_alta' })).toBe(false)
    const semn = { code: 'PGRST202', message: 'Could not find the function public.fn_izo_doc_salveaza(p_antet, p_doc_id, p_randuri, p_versiune) in the schema cache',
      hint: 'Perhaps you meant to call the function public.fn_izo_doc_salveaza(p_antet, p_doc_id, p_randuri, p_scanuri, p_versiune)' }
    expect(lipsaReceptie(semn)).toBe(false)
    expect(mesajEroareDoc(semn)).toContain('nepotrivire cu serverul')
    expect(mesajEroareDoc(semn)).toContain('p_scanuri')
    expect(lipsaReceptie(null)).toBe(false)
  })
  it('mesajele păstrează textul serverului', () => {
    expect(mesajEroareDoc({ code: '40001', message: 'izo E3: documentul s-a schimbat între timp (versiunea 5, trimisă 4) — reîncarcă' })).toContain('„Verifică”')
    expect(mesajEroareDoc({ code: '23505', message: 'duplicate key value violates unique constraint "ux_izo_doc_identitate"' })).toContain('același furnizor')
    expect(mesajEroareDoc({ code: '23505', message: 'izo E3: o serie din document a fost înregistrată între timp de alt document: 999TS00216' })).toContain('999TS00216')
    expect(mesajEroareDoc({ code: '23505', message: 'duplicate key value violates unique constraint "izo_documente_intrare_inlocuieste_document_id_key"' })).toContain('deja înlocuit')
    expect(mesajEroareDoc({ code: '23505', message: 'izo E3: documentul e deja confirmat cu alt conținut' })).toContain('deja confirmarea')
    const g = mesajEroareDoc({ code: '42501', message: 'izo E3: nu ești gestionar pe proiectul și depozitul documentului' })
    expect(g).toContain('gestionar'); expect(g).toContain('nu ești gestionar pe proiectul')
    expect(mesajEroareDoc({ code: '42501', message: 'izo E3: proiectul nu are registrul de țeavă activ' })).toBe('refuzat de server: izo E3: proiectul nu are registrul de țeavă activ')
    expect(mesajEroareDoc({ code: '42501', message: 'izo E3: documentul e confirmat; se editează doar ciornele' })).toContain('nu mai e draft')
    expect(mesajEroareDoc({ code: '22023', message: 'izo E3: cheie necunoscută în antet: scanuri' })).toBe('izo E3: cheie necunoscută în antet: scanuri [22023]')
    expect(mesajEroareDoc({ code: 'P0001', message: 'alt mesaj' })).toBe('alt mesaj')
    expect(mesajEroareDoc(new Error('rețea'))).toBe('rețea')
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

describe('încărcarea din BD', () => {
  it('rândul din BD → editor (mm întregi → metri), fără aliasurile istorice lungime_*_m', () => {
    const r = randDinBd({ nr_crt: 11, serie: '999TS00216', sarja: 'TS00023', lot: '912', lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372, perete_mm: 7.1,
      diametru_mm: 610, decizie: 'primit', observatie: 'măsurat', bucata_id: 901 })
    expect(r).toMatchObject({ nr_crt: '11', lungime_doc: '12,22', lungime_masurata: '12,19', greutate_kg: '1372', perete_mm: '7,1', diametru_mm: '610', bucata_id: 901 })
    expect(randDinBd({ nr_crt: 1, serie: 'x', lungime_doc_m: 6.04 }).lungime_doc).toBe('')
    const a = antetDinBd({ furnizor: 'FURNIZOR TEST SRL', nr_document: 'TEST-2610222', data_document: '2026-10-22T00:00:00', total_m: 180.93, total_kg: 20318 })
    expect(a).toMatchObject({ furnizor: 'FURNIZOR TEST SRL', nr_document: 'TEST-2610222', data_document: '2026-10-22', total_m: '180,93', total_kg: '20318' })
    const d = { sablon: 'aviz_teava', proiect_id: 77, depozit_id: 5, id: 3, versiune: 2, antet: a, randuri: [r] }
    expect(argumenteSalveaza(d).p_antet).toMatchObject({ total_m: 180.93, total_kg: 20318 })
    expect(argumenteSalveaza(d).p_randuri[0]).toMatchObject({ lungime_doc_mm: 12220, lungime_masurata_mm: 12190, greutate_kg: 1372 })
  })
})

describe('scanurile: bucket izo-documente, cale <document>/<uuid v4>.pdf, fără upsert, 10 MB după conversie', () => {
  const storageFals = (raspuns = {}) => {
    const apeluri = []
    return { apeluri, from: bucket => ({
      upload: async (...a) => { apeluri.push(['upload', bucket, ...a]); return raspuns.upload ?? { data: {}, error: null } },
      remove: async (...a) => { apeluri.push(['remove', bucket, ...a]); return raspuns.remove ?? { data: [{ name: a[0][0] }], error: null } },
      createSignedUrl: async (...a) => { apeluri.push(['sign', bucket, ...a]); return { data: { signedUrl: 'https://x/semnat' }, error: null } },
    }) }
  }
  it('calea: document + UUID v4 litere mici; altceva e refuzat', () => {
    expect(BUCKET_SCANURI).toBe('izo-documente')
    expect(caleScan(12, UUID1.toUpperCase())).toBe(`12/${UUID1}.pdf`)
    expect(() => caleScan(12, '3f1c2d4e-5a6b-1c7d-8e9f-0a1b2c3d4e5f')).toThrow(/uuid v4/)   // v1, nu v4
    expect(() => caleScan(null, UUID1)).toThrow()
    expect(caleScan(12, globalThis.crypto.randomUUID())).toMatch(RE_CALE_SCAN)
  })
  it('PDF: hash-urile (64 hex), mărimea, calea; poza trece prin imageToPdf; peste 10 MB după conversie → refuz', async () => {
    const pdf = new Blob(['%PDF-1.4 test'], { type: 'application/pdf' })
    const s = await pregatesteScan(12, pdf, { uuid: () => UUID1 })
    expect(s).toMatchObject({ cale: `12/${UUID1}.pdf`, marime: pdf.size, mime: 'application/pdf' })
    expect(s.sha256_original).toMatch(/^[0-9a-f]{64}$/)
    expect(s.sha256_pdf).toBe(s.sha256_original)
    const poza = new Blob(['jpeg'], { type: 'image/jpeg' })
    const p = await pregatesteScan(12, poza, { uuid: () => UUID2, imageToPdf: async () => new Blob(['%PDF din poză'], { type: 'application/pdf' }) })
    expect(p.sha256_pdf).not.toBe(p.sha256_original)
    const mare = { size: MAX_SCAN_OCTETI + 1, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(1) }
    await expect(pregatesteScan(12, poza, { uuid: () => UUID2, imageToPdf: async () => mare })).rejects.toThrow(/maxim 10 MB/)
    await expect(pregatesteScan(12, new Blob(['x'], { type: 'text/plain' }), {})).rejects.toThrow(/doar PDF/)
  })
  it('încărcarea: bucket-ul izo-documente, upsert false, application/pdf; ștergerea refuzată (data = []) nu e raportată ca reușită', async () => {
    const st = storageFals()
    await urcaScan(st, { cale: `12/${UUID1}.pdf`, pdf: 'blob' })
    expect(st.apeluri[0]).toEqual(['upload', 'izo-documente', `12/${UUID1}.pdf`, 'blob', { contentType: 'application/pdf', upsert: false }])
    expect(await stergeScanObiect(st, `12/${UUID1}.pdf`)).toBe(true)
    expect(st.apeluri[1]).toEqual(['remove', 'izo-documente', [`12/${UUID1}.pdf`]])
    expect(await stergeScanObiect(storageFals({ remove: { data: [], error: null } }), 'x')).toBe(false)
    expect(await linkScan(st, `12/${UUID1}.pdf`)).toBe('https://x/semnat')
    expect(st.apeluri[2]).toEqual(['sign', 'izo-documente', `12/${UUID1}.pdf`, 600])
    await expect(urcaScan(storageFals({ upload: { error: { message: 'Bucket not found' } } }), { cale: 'c', pdf: 'b' })).rejects.toThrow(/izo-documente/)
  })
  it('sha256 hex (declarat de client până la E9)', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('contractul RPC — fixture INDEPENDENT (listele copiate din E3_CONTRACT_RPC.md, nu din constantele implementării)', () => {
  const s = l => [...l].sort()
  const ANTET_CREARE = ['proiect_id', 'depozit_id', 'sablon'], ANTET_INLOCUIRE = ['inlocuieste_document_id', 'motiv_inlocuire']
  const ANTET_COMUNE = ['furnizor', 'furnizor_cif', 'nr_document', 'data_document', 'observatii']
  const ANTET_AVIZ = ['cumparator', 'transport_nr', 'nume_proiect', 'lot', 'loc_livrare', 'data_incarcare', 'data_descarcare', 'nr_camion', 'total_m', 'total_kg']
  const ANTET_CURBE = ['factura', 'importator', 'destinatar', 'referinta_client', 'referinta_furnizor', 'placa_camion_container', 'total_bucati',
    'total_pachete', 'total_net_kg', 'total_brut_kg']
  const RAND_COMUNE = ['nr_crt', 'serie', 'sarja', 'lot', 'specificatie', 'dimensiune', 'grad_otel', 'standard', 'izolatie', 'diametru_mm', 'perete_mm',
    'greutate_kg', 'decizie', 'motiv', 'observatie']
  const RAND_TEAVA = ['lungime_doc_mm', 'lungime_masurata_mm']
  const RAND_CURBE = ['cod', 'item', 'unghi_doc', 'unghi_masurat', 'cantitate', 'pachet_nr', 'dimensiuni_cm', 'net_kg', 'brut_kg']
  const SCAN = ['cale', 'sha256_original', 'sha256_pdf', 'marime', 'mime']
  it('fn_izo_doc_salveaza: creare / creare cu înlocuire / editare / rânduri / manifest — exact cheile contractului', () => {
    expect(chei(argumenteSalveaza(docAviz1()))).toEqual(['p_antet', 'p_doc_id', 'p_randuri', 'p_scanuri', 'p_versiune'])
    expect(chei(argumenteSalveaza(docAviz1()).p_antet)).toEqual(s([...ANTET_CREARE, ...ANTET_COMUNE, ...ANTET_AVIZ]))
    expect(chei(argumenteSalveaza({ ...docCurbe(), inlocuieste_document_id: 3, motiv_inlocuire: 'nr. greșit' }).p_antet))
      .toEqual(s([...ANTET_CREARE, ...ANTET_INLOCUIRE, ...ANTET_COMUNE, ...ANTET_CURBE]))
    expect(chei(argumenteSalveaza({ ...docAviz1(), id: 3, versiune: 2, inlocuieste_document_id: 1, motiv_inlocuire: 'abc' }).p_antet))
      .toEqual(s([...ANTET_COMUNE, ...ANTET_AVIZ]))
    expect(chei(argumenteSalveaza(docAviz1()).p_randuri[0])).toEqual(s([...RAND_COMUNE, ...RAND_TEAVA]))
    expect(chei(argumenteSalveaza(docCurbe()).p_randuri[0])).toEqual(s([...RAND_COMUNE, ...RAND_CURBE]))
    const d = { ...docAviz1(), id: 12, versiune: 4, scanuri: [scan(12, UUID1)] }
    expect(chei(argumenteSalveaza(d, { scanuri: d.scanuri }).p_scanuri[0])).toEqual(s(SCAN))
  })
  it('confirma / pv / anuleaza_draft: exact argumentele contractului', () => {
    expect(chei(argumenteConfirma(1, { versiune: 1, hash: 'h' }))).toEqual(['p_doc_id', 'p_hash', 'p_versiune'])
    expect(chei(argumentePv({ id: 1, versiune: 1 }, 'PV', '2026-10-23'))).toEqual(['p_doc_id', 'p_pv_data', 'p_pv_nr', 'p_versiune'])
    expect(chei(argumenteAnuleazaDraft({ id: 1, versiune: 1 }, 'abc'))).toEqual(['p_doc_id', 'p_motiv', 'p_versiune'])
  })
})

describe('blocantele serverului (fn_izo_doc_blocante) oglindite local — review #826 r1', () => {
  const rn = (extra, base = randAviz(AVIZ2[10])) => randNormalizat({ ...base, ...extra }, 'aviz_teava')
  const niv = v => v.map(x => `${x.nivel}:${x.camp}`)
  it('motivul refuzului / neconformității: cel puțin 3 caractere după trim (motiv_lipsa)', () => {
    expect(niv(validareRand(rn({ decizie: 'refuzat_la_receptie', motiv: ' x ' }), 'aviz_teava'))).toContain('blocant:motiv')
    expect(niv(validareRand(rn({ decizie: 'primit_neconform', motiv: 'ab' }), 'aviz_teava'))).toContain('blocant:motiv')
    expect(validareRand(rn({ decizie: 'primit_neconform', motiv: 'abc' }), 'aviz_teava')).toEqual([])
    // un motiv prea scurt nu „explică” nici diferența peste toleranță
    expect(niv(validareRand(rn({ decizie: 'primit_neconform', motiv: 'ab', lungime_masurata: '12.19' }), 'aviz_teava'))).toContain('blocant:observatie')
  })
  it('peretele lipsă: blocant la primit / neconform (perete_lipsa), doar avertisment la refuzat', () => {
    expect(niv(validareRand(rn({ perete_mm: '' }), 'aviz_teava'))).toContain('blocant:perete_mm')
    expect(niv(validareRand(rn({ perete_mm: '', decizie: 'primit_neconform', motiv: 'izolație lovită' }), 'aviz_teava'))).toContain('blocant:perete_mm')
    expect(niv(validareRand(rn({ perete_mm: '', decizie: 'refuzat_la_receptie', motiv: 'fără marcaj' }), 'aviz_teava'))).toEqual(['avertisment:perete_mm'])
  })
  it('pachetele: DISTINCT pe valoarea scrisă (ca count(DISTINCT pachet_nr)) — „P-1” și „P1” sunt două', () => {
    const r = [randNormalizat({ ...randCurba(CURBE[0]), pachet_nr: 'P-1' }, 'lista_ambalare_curbe'), randNormalizat({ ...randCurba(CURBE[1]), pachet_nr: 'P1' }, 'lista_ambalare_curbe'),
      randNormalizat({ ...randCurba(CURBE[2]), pachet_nr: ' P1 ' }, 'lista_ambalare_curbe')]
    expect(totaluriDocument('lista_ambalare_curbe', {}, r).pachete).toBe(2)
  })
  it('totalurile: total_m / total_bucati obligatorii; kg / pachete / net / brut doar dacă sunt scrise (avertisment când lipsesc)', () => {
    const a = docAviz1(); a.antet.total_kg = ''
    expect(validareDocument(a).blocante).toBe(0)
    expect(niv(validareDocument(a).document)).toContain('avertisment:total_kg')
    const b = docAviz1(); b.antet.total_m = ''
    expect(niv(validareDocument(b).document)).toContain('blocant:total_m')
    const c = docCurbe(); c.antet.total_pachete = ''; c.antet.total_net_kg = ''
    expect(validareDocument(c).blocante).toBe(0)
    const e = docCurbe(); e.antet.total_bucati = ''
    expect(niv(validareDocument(e).document)).toContain('blocant:total_bucati')
    const f = docAviz1(); f.antet.total_kg = '10,193'   // scris greșit → blocant (ca serverul)
    expect(niv(validareDocument(f).document)).toContain('blocant:total_kg')
  })
  it('kg cu cel mult o zecimală: fără rotunjire tăcută (blocant în ecran și la salvare); totalurile la precizia coloanei', () => {
    expect(niv(validareRand(rn({ greutate_kg: '672,55' }), 'aviz_teava'))).toContain('blocant:greutate_kg')
    const d = docAviz1(); d.randuri[0].greutate_kg = '672.55'
    expect(eroriSalvare(d)).toContain('Rândul 1: greutatea are cel mult o zecimală.')
    expect(randPentruRpc(rn({ greutate_kg: '672,5' }), 'aviz_teava').greutate_kg).toBe(672.5)
    const c = docCurbe(); c.randuri[0].net_kg = '1132,25'
    expect(eroriSalvare(c)).toContain('Rândul 1: greutatea netă are cel mult o zecimală.')
    const t = docAviz1(); t.antet.total_m = '90,7505'; t.antet.total_kg = '10192,25'
    expect(eroriSalvare(t)).toEqual(['„Total metri” are prea multe zecimale (3 cel mult).', '„Total kg” are prea multe zecimale (1 cel mult).'])
  })
})

describe('atașarea scanului: ștergerea fișierului doar când e sigur în afara manifestului — review #826 r1', () => {
  const S0 = { cale: `12/${UUID1}.pdf`, pdf: 'blob' }
  const stor = (upload = { data: {}, error: null }, remove = null) => {
    const apeluri = []
    return { apeluri, from: () => ({
      upload: async () => { apeluri.push('upload'); return upload },
      remove: async a => { apeluri.push('remove'); return remove ?? { data: [{ name: a[0] }], error: null } },
    }) }
  }
  const sal = (st, rasp) => async () => { st.apeluri.push('salveaza'); if (rasp instanceof Error) throw rasp; return rasp }
  it('eroareDefinitivaRpc: excepție Postgres / cod PostgREST / 4xx = definitiv; transport / 5xx fără cod / 408 = ambiguu', () => {
    for (const [e, st] of [[{ code: '40001' }, 500], [{ code: '23514' }, 400], [{ code: '42501' }, 403], [{ code: 'P0001' }, 400], [{ code: '22023' }, 400],
      [{ code: '25001' }, 500], [{ code: 'PGRST202' }, 404], [{ code: 'PGRST100' }, 400], [{ code: 'PGRST301' }, 401], [{ message: 'x' }, 409]])
      expect(eroareDefinitivaRpc(e, st)).toBe(true)
    for (const [e, st] of [[{ message: 'TypeError: Failed to fetch', code: '' }, 0], [{ message: 'x' }, 500], [{ message: 'x' }, 502], [{ message: 'x' }, 504],
      [{ message: 'x' }, 408], [{ message: 'x' }, undefined],
      // review #826 r2: conexiunea la BD (PGRST0xx) nu dovedește rollback-ul — „Database client error” în timpul comenzii, COMMIT cu răspuns pierdut
      [{ code: 'PGRST000' }, 503], [{ code: 'PGRST001', message: 'Database client error. Retrying the connection.' }, 503], [{ code: 'PGRST003' }, 504],
      [{ code: 'PGRSTX00' }, 500]]) expect(eroareDefinitivaRpc(e, st)).toBe(false)
  })
  it('succes: întâi upload, apoi salvarea; nimic șters', async () => {
    const st = stor()
    const r = await ataseazaScanSigur({ storage: st, scan: S0, salveaza: sal(st, { data: { document_id: 12 }, error: null, status: 200 }) })
    expect(r).toMatchObject({ rez: 'atasat', data: { document_id: 12 }, orfan: null })
    expect(st.apeluri).toEqual(['upload', 'salveaza'])
  })
  it('salvare refuzată DEFINITIV (23514 / 40001) → fișierul (în afara manifestului) se șterge', async () => {
    for (const err of [{ code: '23514', message: 'scan' }, { code: '40001', message: 's-a schimbat' }]) {
      const st = stor()
      const r = await ataseazaScanSigur({ storage: st, scan: S0, salveaza: sal(st, { data: null, error: err, status: 400 }) })
      expect(r).toMatchObject({ rez: 'nesalvat', error: err, orfan: null })
      expect(st.apeluri).toEqual(['upload', 'salveaza', 'remove'])
    }
  })
  it('salvare AMBIGUĂ (transport căzut / 504 / PGRST001 / excepție) → fișierul RĂMÂNE (salvarea poate fi încă în zbor)', async () => {
    for (const rasp of [{ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }, { data: null, error: { message: 'Gateway Timeout' }, status: 504 },
      { data: null, error: { code: 'PGRST001', message: 'Database client error' }, status: 503 }, new Error('rețea')]) {
      const st = stor()
      const r = await ataseazaScanSigur({ storage: st, scan: S0, salveaza: sal(st, rasp) })
      expect(r).toMatchObject({ rez: 'necunoscut', orfan: S0.cale })
      expect(st.apeluri).toEqual(['upload', 'salveaza'])
    }
  })
  it('upload eșuat: definitiv (4xx) → fără salvare, fără ștergere; ambiguu (fără status / 5xx) → fără salvare, ștergere best-effort', async () => {
    const st1 = stor({ data: null, error: { message: 'new row violates row-level security policy', status: 403 } })
    expect(await ataseazaScanSigur({ storage: st1, scan: S0, salveaza: sal(st1, {}) })).toMatchObject({ rez: 'nesalvat', orfan: null })
    expect(st1.apeluri).toEqual(['upload'])
    const st2 = stor({ data: null, error: { message: 'Failed to fetch' } }, { data: [], error: null })   // obiectul nu există (încă)
    expect(await ataseazaScanSigur({ storage: st2, scan: S0, salveaza: sal(st2, {}) })).toMatchObject({ rez: 'nesalvat', orfan: S0.cale })
    expect(st2.apeluri).toEqual(['upload', 'remove'])
    const st3 = stor({ data: null, error: { message: 'Internal', status: 500 } })   // DELETE „reușit” nu dovedește nimic: un upload în zbor apare după
    expect(await ataseazaScanSigur({ storage: st3, scan: S0, salveaza: sal(st3, {}) })).toMatchObject({ rez: 'nesalvat', orfan: S0.cale })
    expect(st3.apeluri).toEqual(['upload', 'remove'])
  })
})

describe('componenta IzoDocumenteIntrare.jsx (sursa): doar contractul', () => {
  const src = readFileSync(new URL('./IzoDocumenteIntrare.jsx', import.meta.url), 'utf8')
  it('nicio referință la bucket-ul `avize`; Storage doar prin ajutoarele cu BUCKET_SCANURI', () => {
    expect(src).not.toMatch(/['"`]avize['"`]/)
    expect(src).not.toMatch(/storage\s*\.\s*from\s*\(/)
    expect(src).toMatch(/ataseazaScanSigur\(\{ storage: supabase\.storage/)   // upload + salvare + curățenie: ordinea testată pe ajutor
    expect(src).not.toMatch(/urcaScan\(/)
    expect(src).toMatch(/stergeScanObiect\(supabase\.storage/)
  })
  it('scoaterea scanului: întâi salvarea fără el, abia apoi DELETE pe obiect; la eroare (inclusiv ambiguă) fără DELETE', () => {
    const corp = src.slice(src.indexOf('const scoateScan'), src.indexOf('const vedeScan'))
    expect(corp.indexOf(".rpc('fn_izo_doc_salveaza'")).toBeGreaterThan(-1)
    expect(corp.indexOf('stergeScanObiect(')).toBeGreaterThan(corp.indexOf(".rpc('fn_izo_doc_salveaza'"))
    expect(corp).toMatch(/if \(error\) \{[^}]*throw error \}/)   // eroarea iese înainte de DELETE
  })
  it('review #826 r1: editorul ia doar ultima încărcare; CAS pierdut → conflict; depozite active; „în pregătire” doar până la prima listă', () => {
    expect(src).toMatch(/const c = \+\+cerereEd\.current/)
    expect((src.match(/if \(c !== cerereEd\.current\) return null/g) || []).length).toBe(2)
    expect(src).toMatch(/if \(e40001\(error\) && doc\.id\) marcheazaConflict\(doc\.id\)/)
    expect(src).toMatch(/if \(doc\.conflict\)/)
    expect(src).toMatch(/d\.site_id === proiect\.site_id && d\.activ === true/)
    expect(src).toMatch(/select\('id, name, cod_3litere, site_id, activ'\)/)
    expect(src).toMatch(/!sondaGata\.current && lipsaReceptie\(e\)/)
    expect(src).toMatch(/golesteLista\(\)\s*\n\s*if \(!sondaGata/)   // la eșec lista veche (alt proiect) dispare
  })
  it('review #826 r2: răspuns pierdut la atașare peste modificări nesalvate → fără reîncărcare automată; conflictul oprește și anularea; lista golită la schimbarea proiectului', () => {
    const corp = src.slice(src.indexOf('const adaugaScan'), src.indexOf('const scoateScan'))
    const ramura = corp.slice(corp.indexOf('// cu modificări nesalvate: NU reîncarc automat'))
    expect(ramura).toMatch(/marcheazaConflict\(id, 'incert'\)/)
    expect(ramura.slice(0, ramura.indexOf('} catch'))).not.toMatch(/deschide\(/)
    expect(corp).toMatch(/\} else if \(!doc\.dirty\) \{/)
    expect(src).toMatch(/const poateAnula = [^\n]*!ed\.conflict/)
    expect(src.slice(src.indexOf('const anuleazaCiorna'), src.indexOf('const adaugaScan'))).toMatch(/if \(opritScriere\(ed\)\) return/)
    expect(src).toMatch(/onChange=\{e => \{ golesteLista\(\); setProiectId\(/)
  })
  it('RPC-urile chemate = cele din contract (fără anularea administrativă), salvarea doar cu argumenteSalveaza', () => {
    const rpc = [...src.matchAll(/\.rpc\(\s*'([^']+)'/g)].map(m => m[1])
    expect([...new Set(rpc)].sort()).toEqual(['fn_izo_doc_anuleaza_draft', 'fn_izo_doc_confirma', 'fn_izo_doc_pv', 'fn_izo_doc_salveaza', 'fn_izo_doc_verifica', 'fn_izo_proiecte_protejate'])
    expect([...src.matchAll(/\.rpc\(\s*'fn_izo_doc_salveaza',\s*(\w+)\(/g)].map(m => m[1])).toEqual(['argumenteSalveaza', 'argumenteSalveaza', 'argumenteSalveaza'])
    expect(src).toMatch(/\.rpc\('fn_izo_doc_anuleaza_draft', argumenteAnuleazaDraft\(/)
    expect(src).toMatch(/\.rpc\('fn_izo_doc_confirma', argumenteConfirma\(id, verif\)\)/)
  })
  it('nicio scriere directă pe tabelele izo_*; „în pregătire” doar la sonda inițială', () => {
    expect(src).not.toMatch(/from\('izo_[a-z_]+'\)\s*\.\s*(insert|update|upsert|delete)\(/)
    expect((src.match(/inPregatire\(\)/g) || []).length).toBe(2)       // incarca + incarcaDocs
    expect((src.match(/lipsaReceptie\(/g) || []).length).toBe(2)
  })
})
import { randPoatePrimiBulk, problemeDeVerificat, diferenteCodCurba, valoareDinCod, codCuValoare, geometrieRotatie, limiteCrop, cropDinPreview, rotesteCrop } from './izoDocumenteLogica.js'

describe('E3/E9 bulk și corecții explicite', () => {
  const sablon = 'lista_ambalare_curbe'
  const baza = { ...randGol(sablon, 8), serie:'1029', sarja:'2513619', item:'9', cod:'1029-610-8,8-25-6100-2513614-9', diametru_mm:'610', perete_mm:'8,8', unghi_doc:'25', pachet_nr:'4', decizie:'', net_kg:'' }
  const bulk = (r, randuri = [r]) => { const doc = { sablon, antet:{}, randuri:[r, ...randuri.slice(1)] }; const v = validareDocument(doc); return randPoatePrimiBulk(v.norm[0], sablon, doc, v.randuri[0]) }
  it('heat greșit: textul vechi rămâne, cod și heat sunt structurate', () => {
    const n = randNormalizat(baza, sablon), v = validareRand(n, sablon), cod = v.find(x => x.camp === 'cod')
    expect(verificaCodCurba(n)).toBe('codul spune heat 2513614 — nu bate cu rândul')
    expect(cod.campuri).toEqual(['cod', 'sarja'])
    expect(cod.diferente).toEqual([{ camp:'sarja', label:'heat', valoare:'2513614' }])
    expect(problemeDeVerificat(v).map(x => x.camp)).toEqual(['cod'])
    expect(bulk(baza)).toBe(false)
  })
  it('kg pe alt rând al aceluiași pachet permit bulk; deciziile existente rămân', () => {
    const r = { ...baza, cod:'', serie:'1028' }, alt = { ...baza, nr_crt:'9', net_kg:'1500', brut_kg:'1550' }
    expect(bulk(r, [r, alt])).toBe(true)
    expect(bulk(r, [r, { ...alt, pachet_nr:'5' }])).toBe(false)
    expect(bulk(r, [r, { ...alt, net_kg:'abc' }])).toBe(false)
    expect(bulk({ ...r, decizie:'refuzat_la_receptie', motiv:'rupt' })).toBe(false)
    expect(bulk({ ...r, perete_mm:'' }, [r, alt])).toBe(false)
  })
  it('aviz fără greutate trece; seria suspectă și toleranța explicată nu trec', () => {
    const r = { ...randGol('aviz_teava', 1), serie:'247EK08603', lungime_doc:'12', perete_mm:'8', decizie:'' }
    const ok = r => randPoatePrimiBulk(randNormalizat(r, 'aviz_teava'), 'aviz_teava', { randuri:[r] })
    expect(ok(r)).toBe(true)
    expect(ok({ ...r, serie:'247EK086O3' })).toBe(false)
    expect(ok({ ...r, lungime_masurata:'12,02', observatie:'verificat' })).toBe(false)
  })
  it('corecțiile păstrează celelalte părți, virgula și zerourile', () => {
    expect(valoareDinCod(baza.cod, 'perete_mm')).toBe('8,8')
    expect(codCuValoare(baza.cod, 'sarja', baza.sarja)).toBe('1029-610-8,8-25-6100-2513619-9')
    expect(diferenteCodCurba(randNormalizat({ ...baza, sarja:'2513614' }, sablon))).toEqual([])
    expect(codCuValoare('invalid', 'sarja', '1')).toBe(null)
    expect(codCuValoare(baza.cod, 'sarja', '1-2')).toBe(null)
    expect(diferenteCodCurba(randNormalizat({ ...baza, serie:'1030', item:'8', perete_mm:'10', diametru_mm:'600', unghi_doc:'30' }, sablon)).map(d => d.camp)).toEqual(['serie', 'diametru_mm', 'perete_mm', 'unghi_doc', 'sarja', 'item'])
  })
})
describe('imagine: rotire apoi decupare', () => {
  it('rotațiile au dimensiuni și translație corecte', () => {
    expect(geometrieRotatie(400, 600, 90)).toEqual({ width:600, height:400, rotatie:90, x:600, y:0 })
    expect(geometrieRotatie(400, 600, 180)).toEqual({ width:400, height:600, rotatie:180, x:400, y:600 })
    expect(geometrieRotatie(400, 600, 270)).toEqual({ width:600, height:400, rotatie:270, x:0, y:400 })
    expect(geometrieRotatie(400, 600, 45)).toEqual(geometrieRotatie(400, 600))
  })
  it('limite, minim 50px și conversie din preview', () => {
    expect(limiteCrop({ x:-10, y:999, width:2, height:900 }, 400, 600)).toEqual({ x:0, y:0, width:50, height:600 })
    expect(cropDinPreview({ x:10, y:20, width:100, height:150 }, 200, 300, 400, 600)).toEqual({ x:20, y:40, width:200, height:300 })
    expect(limiteCrop(null, 20, 30)).toEqual({ x:0, y:0, width:20, height:30 })
  })
  it('rotația automată păstrează regiunea decupată', () => {
    const rect = { x:20, y:40, width:100, height:200 }, r90 = rotesteCrop(rect, 400, 600, 90)
    expect(r90).toEqual({ x:360, y:20, width:200, height:100 })
    expect(rotesteCrop(r90, 600, 400, 270)).toEqual(rect)
    expect(rotesteCrop(null, 400, 600, 90)).toBe(null)
  })
  it('codCuValoare scrie peretele cu virgulă (Jak ux2 P2)', () => {
    expect(codCuValoare('1029-610-8-25-6100-2513619-9', 'perete_mm', '7.1')).toBe('1029-610-7,1-25-6100-2513619-9')
  })
})
