import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaTgz, scrieImport, parseazaNrCrt, imparteAdresa, cheieSursa, LOT, LOT_CITIRE, RPC_REZERVA_NUMERE, MOTIV_AMBIGUU, MOTIV_CONTRADICTORIU } from '../importTgz.js'

// ───────── fixture: xlsx fictiv construit în test (antet pe rândul 3) ─────────
const ANTET = ['Nr.Crt.', 'Nr.Poz.Hg.', 'UAT', 'Județ', 'Nume Deținător', 'Adresă', 'Suprafață Afectată Temporar',
  'Categorie Folosință', 'Tarla/Nr. Topo', 'Nr. cadastral/Parcelă', 'Regim juridic']

function xlsxDin(randuri, { antet = ANTET, randAntet = 3 } = {}) {
  const aoa = []
  for (let i = 1; i < randAntet; i++) aoa.push(i === 1 ? ['Raport Informatii Generale Terenuri — FICTIV'] : [])
  aoa.push(antet)
  for (const r of randuri) aoa.push(r)
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Raport')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

const UATS = [
  { id: 'uuid-hus', nume: 'Husnicioara', uat3: 'HUS' },
  { id: 'uuid-pru', nume: 'Prunișor', uat3: 'PRU' },
]
const OPT = { uats: UATS, tronsonPeUat: { HUS: 3, PRU: 2 }, versiune: 'TGZ 13.07.2026', sursa: 'TGZ' }

// 12 rânduri fictive: proprietar simplu, coproprietari 7/1 și 7/2, neidentificat, adresă goală, UAT necunoscut, dublură...
const RANDURI = [
  ['1', 'HG 1', 'Husnicioara', 'Mehedinți', 'Test Proprietar Unu', 'Sat Peri, Com. Husnicioara, Str. Fictivă nr. 1', '120,5', 'arabil', 'T12', 'CF 1001', 'privat'],
  ['2', 'HG 2', 'Husnicioara', 'Mehedinți', 'Test Proprietar Doi', 'Str. Exemplu nr. 2', 80, 'pășune', 'T13', 'CF 1002', 'privat'],
  ['7/1', 'HG 7', 'Husnicioara', 'Mehedinți', 'Test Coproprietar Alfa', 'Sat Peri, Com. Husnicioara', 300, 'arabil', 'T20', 'CF 1007', 'privat'],
  ['7/2', 'HG 7', 'Husnicioara', 'Mehedinți', 'Test Coproprietar Beta', 'Com. Husnicioara, sat Peri', 300, 'arabil', 'T20', 'CF 1007', 'privat'],
  ['8', 'HG 8', 'Husnicioara', 'Mehedinți', 'Proprietar NEIDENTIFICAT', '', 50, 'fâneață', 'T21', 'CF 1008', 'neclarificat'],
  ['9', 'HG 9', 'Husnicioara', 'Mehedinți', 'Test Fără Adresă', '', 60, 'arabil', 'T22', 'CF 1009', 'privat'],
  ['10', 'HG 10', 'Comuna Inexistentă', 'Mehedinți', 'Test Uat Gresit', 'Str. X', 10, 'arabil', 'T1', 'CF 1', 'privat'],
  ['11', 'HG 11', 'Husnicioara', 'Mehedinți', 'Test Dublură', 'Str. Y nr. 3', 20, 'arabil', 'T23', 'CF 1011', 'privat'],
  ['11', 'HG 11', 'Husnicioara', 'Mehedinți', 'TEST  DUBLURĂ', 'Str. Y nr. 3', 20, 'arabil', 'T23', 'CF 1011', 'privat'],
  ['12', 'HG 12', 'Prunișor', 'Mehedinți', 'Test Prunisor Unu', 'Com. Prunișor, Sat Gârnița', 15, 'arabil', 'T2', 'CF 2001', 'privat'],
  ['abc', 'HG 13', 'Husnicioara', 'Mehedinți', 'Test NrCrt Invalid', 'Str. Z', 5, 'arabil', 'T24', 'CF 1013', 'privat'],
  [13, 'HG 14', 'Husnicioara', 'Mehedinți', 'Test Numeric', 'Jud. Mehedinți, Oraș Strehaia, Str. W nr. 9', 7, 'arabil', 'T25', 'CF 1014', 'privat'],
]

describe('parseazaNrCrt / imparteAdresa / cheieSursa', () => {
  it('Nr.Crt.', () => {
    expect(parseazaNrCrt('7/2')).toEqual({ x: 7, y: 2 })
    expect(parseazaNrCrt(' 7 / 1 ')).toEqual({ x: 7, y: 1 })
    expect(parseazaNrCrt('12')).toEqual({ x: 12, y: null })
    expect(parseazaNrCrt(12)).toEqual({ x: 12, y: null })
    expect(parseazaNrCrt('abc')).toBeNull()
    expect(parseazaNrCrt('0')).toBeNull()
    expect(parseazaNrCrt('')).toBeNull()
    expect(parseazaNrCrt(null)).toBeNull()
  })
  it('adresa best-effort, fără să inventeze', () => {
    expect(imparteAdresa('Sat Peri, Com. Husnicioara, Str. Fictivă nr. 1', 'Mehedinți')).toEqual({
      adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Peri', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți', judet_adresa: null,
    })
    expect(imparteAdresa('Str. Exemplu nr. 2', 'Mehedinți')).toEqual({ adresa_strada: 'Str. Exemplu nr. 2', adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți', judet_adresa: null })
    expect(imparteAdresa('ceva ce nu se poate împărți', null)).toEqual({ adresa_strada: 'ceva ce nu se poate împărți', adresa_sat: null, adresa_comuna: null, adresa_judet: null, judet_adresa: null })
    expect(imparteAdresa('', 'Mehedinți')).toEqual({ adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți', judet_adresa: null })
    // „Satu Mare” nu e „Sat …”
    expect(imparteAdresa('Satu Mare', null).adresa_strada).toBe('Satu Mare')
  })
  it('P1-3: județul explicit din adresă prevalează față de coloana Județ', () => {
    expect(imparteAdresa('Jud. Dolj, Mun. Craiova, bd. Test 5', 'Mehedinți')).toEqual({ adresa_strada: 'bd. Test 5', adresa_sat: null, adresa_comuna: 'Craiova', adresa_judet: 'Dolj', judet_adresa: 'Dolj' })
    expect(imparteAdresa('Str. A, județul Gorj', '')).toMatchObject({ adresa_judet: 'Gorj', judet_adresa: 'Gorj', adresa_strada: 'Str. A' })
  })
  it('cheieSursa: validă doar cu poz_hg SAU nr_cadastral; tarla singură → null', () => {
    expect(cheieSursa('HUS', 'HG 1', 'CF 1001', 'T12')).toBe('HUS|HG 1|CF 1001|T12')
    expect(cheieSursa('hus', ' hg  1 ', 'cf 1001', 'Tărla 12')).toBe('HUS|HG 1|CF 1001|TARLA 12')
    expect(cheieSursa('HUS', null, 'CF 1001', null)).toBe('HUS||CF 1001|')
    expect(cheieSursa('HUS', 'HG 1', null, null)).toBe('HUS|HG 1||')
    expect(cheieSursa('HUS', null, null, 'T12')).toBeNull()
    expect(cheieSursa('HUS', '', null, '  ')).toBeNull()
  })
})

describe('parseazaTgz — preview', () => {
  const p = parseazaTgz(xlsxDin(RANDURI), OPT)

  it('găsește antetul pe rândul 3 și mapează coloanele', () => {
    expect(p.antet.rand).toBe(3)
    expect(Object.keys(p.antet.coloane).sort()).toEqual(['adresa', 'categorie', 'judet', 'nr_cadastral', 'nr_crt', 'nume', 'poz_hg', 'regim', 'suprafata', 'tarla', 'uat'].sort())
  })
  it('numără rândurile și erorile (UAT necunoscut, Nr.Crt. invalid)', () => {
    expect(p.statistici.randuri_total).toBe(12)
    expect(p.erori).toHaveLength(2)
    expect(p.erori.find(e => e.rand === 10)).toMatchObject({ motiv: expect.stringMatching(/UAT necunoscut/) })
    expect(p.erori.find(e => e.rand === 14)).toMatchObject({ motiv: expect.stringMatching(/Nr\.Crt\. invalid/) })
  })
  it('parcele: 7 pe HUS (1,2,7,8,9,11,13) + 1 pe PRU, cheiate pe (uat3, Nr.Crt.), id-uri PROVIZORII, cheie_sursa stabilă', () => {
    expect(p.parcele).toHaveLength(8)
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.id_parcela)).toEqual(Array(7).fill('T3-HUS-????'))
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.nr_provizoriu)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.parcele.find(x => x.uat3 === 'PRU')).toMatchObject({ cheie: 'PRU:12', id_parcela: 'T2-PRU-????', nr_provizoriu: 1, tronson: 2, uat_id: 'uuid-pru', cheie_sursa: 'PRU|HG 12|CF 2001|T2', ambigua: false })
    expect(p.parcele[0]).toMatchObject({ cheie: 'HUS:1', cheie_sursa: 'HUS|HG 1|CF 1001|T12', ambigua: false, nr_crt: 1, uat_id: 'uuid-hus', tronson: 3, poz_hg: 'HG 1', suprafata_temporara_mp: 120.5, categoria_folosinta: 'arabil', tarla: 'T12', nr_cadastral: 'CF 1001', observatii: 'Regim juridic: privat' })
    expect(p.statistici).toMatchObject({ parcele_fara_cheie: 0, parcele_ambigue: 0, fara_cheie: 0, ambigue: 0, judet_diferit: 0 })
    expect(p.fara_cheie).toEqual([]); expect(p.ambigue).toEqual([])
  })
  it('idStart e ignorat (compatibilitate)', () => {
    const p2 = parseazaTgz(xlsxDin(RANDURI), { ...OPT, idStart: { HUS: 500 } })
    expect(p2.parcele[0].id_parcela).toBe('T3-HUS-????')
  })
  it('coproprietarii 7/1 și 7/2 stau pe aceeași parcelă, cu calitate coproprietar', () => {
    const p7 = p.parcele.find(x => x.nr_crt === 7)
    const dets = p.detinatori.filter(d => d.cheie_parcela === p7.cheie)
    expect(dets).toHaveLength(2)
    expect(dets.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
    expect(p7.nr_detinatori).toBe(2)
  })
  it('proprietar simplu, cu sursa și versiunea', () => {
    expect(p.detinatori[0]).toMatchObject({ nume: 'Test Proprietar Unu', nume_normalizat: 'TEST PROPRIETAR UNU', calitate: 'proprietar', cota: null, sursa_date: 'TGZ', versiune_lista_tgz: 'TGZ 13.07.2026', cheie_parcela: 'HUS:1', cheie: 'HUS:1|TEST PROPRIETAR UNU' })
  })
  it('neidentificat → calitate neidentificat + adresa_cunoscuta=false', () => {
    const d = p.detinatori.find(x => x.nume.includes('NEIDENTIFICAT'))
    expect(d.calitate).toBe('neidentificat')
    expect(p.contacte.find(c => c.cheie_detinator === d.cheie).adresa_cunoscuta).toBe(false)
    expect(p.neidentificati).toHaveLength(1)
    expect(p.neidentificati[0]).toMatchObject({ rand: 8, cheie_parcela: 'HUS:8', nr_crt: 8 })
  })
  it('adresă goală → adresa_cunoscuta=false, dar calitatea rămâne proprietar', () => {
    const d = p.detinatori.find(x => x.nume === 'Test Fără Adresă')
    expect(d.calitate).toBe('proprietar')
    expect(p.contacte.find(c => c.cheie_detinator === d.cheie)).toMatchObject({ adresa_cunoscuta: false, adresa_strada: null, adresa_judet: 'Mehedinți' })
  })
  it('dublura (aceeași parcelă + nume normalizat) nu intră în deținători, e raportată', () => {
    expect(p.dubluri).toHaveLength(1)
    expect(p.dubluri[0]).toMatchObject({ rand: 12, rand_original: 11, nume_normalizat: 'TEST DUBLURA', nr_crt: 11, cheie_parcela: 'HUS:11' })
    expect(p.detinatori.filter(d => d.nume_normalizat === 'TEST DUBLURA')).toHaveLength(1)
  })
  it('adresa se împarte în strada/sat/comuna/judet', () => {
    const d1 = p.detinatori[0]
    expect(p.contacte.find(c => c.cheie_detinator === d1.cheie)).toMatchObject({ adresa_strada: 'Str. Fictivă nr. 1', adresa_sat: 'Peri', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinți', adresa_cunoscuta: true, cod_postal: null })
    const d13 = p.detinatori.find(x => x.nume === 'Test Numeric')
    expect(p.contacte.find(c => c.cheie_detinator === d13.cheie)).toMatchObject({ adresa_strada: 'Str. W nr. 9', adresa_comuna: 'Strehaia', adresa_judet: 'Mehedinți', judet_adresa: 'Mehedinți' })
    // același județ în adresă și în coloană → fără notă
    expect(p.parcele.find(x => x.nr_crt === 13).observatii).toBe('Regim juridic: privat')
  })
  it('statistici și un contact per deținător', () => {
    expect(p.contacte).toHaveLength(p.detinatori.length)
    expect(p.statistici).toMatchObject({ parcele: 8, detinatori: 9, contacte: 9, dubluri: 1, neidentificati: 1, erori: 2 })
    expect(p.statistici.pe_uat.HUS).toMatchObject({ parcele: 7, detinatori: 8, dubluri: 1, neidentificati: 1, fara_cheie: 0, ambigue: 0 })
    expect(p.statistici.pe_uat.PRU).toMatchObject({ parcele: 1, detinatori: 1 })
  })
})

describe('parseazaTgz — robustețe', () => {
  it('antet tolerant la diacritice/spații/majuscule și pe alt rând', () => {
    const antet = ['NR. CRT', 'nr poz hg', ' uat ', 'JUDET', 'nume detinator', 'adresa', 'suprafata afectata temporar (mp)', 'categorie folosinta', 'tarla / nr topo', 'nr cadastral / parcela', 'regim juridic']
    const p = parseazaTgz(xlsxDin([['1', 'HG', 'HUS', 'MH', 'Test Antet', 'Str. A', 1, 'arabil', 'T', 'CF', 'privat']], { antet, randAntet: 5 }), OPT)
    expect(p.erori).toEqual([])
    expect(p.antet.rand).toBe(5)
    expect(p.parcele).toHaveLength(1)
    expect(p.detinatori[0]).toMatchObject({ nume: 'Test Antet', id_parcela: 'T3-HUS-????' })
  })
  it('P1-1: două Nr.Crt. diferite cu aceeași cheie_sursa validă → ambele AMBIGUE, nu se unesc, eroare pe fiecare rând', () => {
    const p = parseazaTgz(xlsxDin([
      ['1', 'HG 1', 'HUS', 'MH', 'Test A', 'Str. A', 1, 'arabil', 'T1', 'CF 1', ''],
      ['2', 'HG 1', 'HUS', 'MH', 'Test B', 'Str. B', 1, 'arabil', 'T1', 'CF 1', ''],
      ['3', 'HG 3', 'HUS', 'MH', 'Test C', 'Str. C', 1, 'arabil', 'T1', 'CF 3', ''],
    ]), OPT)
    expect(p.parcele).toHaveLength(3)
    expect(p.parcele.map(x => x.ambigua)).toEqual([true, true, false])
    expect(p.detinatori.map(d => d.calitate)).toEqual(['proprietar', 'proprietar', 'proprietar'])
    expect(p.erori).toHaveLength(2)
    expect(p.erori.map(e => e.rand).sort()).toEqual([4, 5])
    expect(p.erori.every(e => e.motiv === MOTIV_AMBIGUU && e.cheie_sursa === 'HUS|HG 1|CF 1|T1')).toBe(true)
    expect(p.ambigue).toEqual([
      { rand: 4, nr_crt: '1', nume: 'Test A', cheie_parcela: 'HUS:1', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU },
      { rand: 5, nr_crt: '2', nume: 'Test B', cheie_parcela: 'HUS:2', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU },
    ])
    expect(p.statistici).toMatchObject({ parcele_ambigue: 2, ambigue: 2, erori: 2 })
    expect(p.statistici.pe_uat.HUS.ambigue).toBe(2)
  })
  it('P1-1 (r5, exemplul Jakarinos): 7/1 și 7/2 cu cadastru DIFERIT sub același Nr.Crt. = contradicție → parcela ambiguă, nu se comite', async () => {
    const p = parseazaTgz(xlsxDin([
      ['7/1', 'HG 7', 'HUS', 'MH', 'Test Coproprietar Alfa', 'Str. A', 300, 'arabil', 'T20', 'CF 1007', ''],
      ['7/2', 'HG 7', 'HUS', 'MH', 'Test Coproprietar Beta', 'Str. B', 300, 'arabil', 'T20', 'CF 1008', ''],
      ['8/1', 'HG 8', 'HUS', 'MH', 'Test Mostenire Unu', 'Str. C', 50, 'arabil', 'T21', 'CF 1009', ''],
      ['8/2', '', 'HUS', 'MH', 'Test Mostenire Doi', 'Str. D', '', '', '', '', ''],          // câmpuri goale = moștenire, OK
      ['9/1', 'HG 9', 'HUS', 'MH', 'Test Tarla Unu', 'Str. E', 10, 'arabil', 'T30', 'CF 1010', ''],
      ['9/2', 'hg  9', 'HUS', 'MH', 'Test Tarla Doi', 'Str. F', 10, 'arabil', 'T31', 'cf 1010', ''],   // tarla diferită → contradicție (HG/CF egale după normalizare)
    ]), OPT)
    expect(p.parcele.map(x => [x.cheie, x.ambigua, x.motiv_ambiguitate])).toEqual([
      ['HUS:7', true, MOTIV_CONTRADICTORIU], ['HUS:8', false, null], ['HUS:9', true, MOTIV_CONTRADICTORIU],
    ])
    expect(p.parcele[0]).toMatchObject({ nr_cadastral: 'CF 1007', nr_detinatori: 2 })   // atributele rămân ale primului rând
    expect(p.erori.map(e => [e.rand, e.motiv])).toEqual([[4, MOTIV_CONTRADICTORIU], [5, MOTIV_CONTRADICTORIU], [8, MOTIV_CONTRADICTORIU], [9, MOTIV_CONTRADICTORIU]])
    expect(p.erori[1].detaliu).toMatch(/cadastru „CF 1007”.*cadastru „CF 1008”/)
    expect(p.ambigue.map(a => [a.rand, a.nume, a.motiv])).toEqual([
      [4, 'Test Coproprietar Alfa', MOTIV_CONTRADICTORIU], [5, 'Test Coproprietar Beta', MOTIV_CONTRADICTORIU],
      [8, 'Test Tarla Unu', MOTIV_CONTRADICTORIU], [9, 'Test Tarla Doi', MOTIV_CONTRADICTORIU],
    ])
    expect(p.statistici).toMatchObject({ parcele: 3, parcele_ambigue: 2, ambigue: 4, detinatori: 6 })
    // la commit se scrie doar parcela 8 cu cei doi deținători
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, p, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1, detinatoriNoi: 2, contacteNoi: 2 })
    expect(r.ambigue.map(a => [a.rand, a.motiv])).toEqual([[4, MOTIV_CONTRADICTORIU], [5, MOTIV_CONTRADICTORIU], [8, MOTIV_CONTRADICTORIU], [9, MOTIV_CONTRADICTORIU]])
    expect(sb.tabele.red_parcele.map(x => x.cheie_sursa)).toEqual(['HUS|HG 8|CF 1009|T21'])
    expect(sb.tabele.red_detinatori.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
  })
  it('P1-1: tarla egală dar HG/cadastru diferite NU e ambiguitate; rândurile x/1, x/2 nu sunt ambigue între ele', () => {
    const p = parseazaTgz(xlsxDin([
      ['1/1', 'HG 1', 'HUS', 'MH', 'Test A', 'Str. A', 1, 'arabil', 'T1', 'CF 1', ''],
      ['1/2', 'HG 1', 'HUS', 'MH', 'Test B', 'Str. B', 1, 'arabil', 'T1', 'CF 1', ''],
      ['2', 'HG 2', 'HUS', 'MH', 'Test C', 'Str. C', 1, 'arabil', 'T1', 'CF 2', ''],
    ]), OPT)
    expect(p.parcele).toHaveLength(2)
    expect(p.erori).toEqual([]); expect(p.ambigue).toEqual([])
  })
  it('P1-2: fără poz_hg și cadastru (doar tarla) → cheie_sursa null, listat separat în fara_cheie', () => {
    const p = parseazaTgz(xlsxDin([
      ['5', '', 'HUS', 'MH', 'Test Fără Cheie', 'Str. A', 1, '', 'T9', '', ''],
      ['6', 'HG 6', 'HUS', 'MH', 'Test Cu Cheie', 'Str. B', 1, '', '', '', ''],
    ]), OPT)
    expect(p.parcele[0]).toMatchObject({ cheie_sursa: null, cheie: 'HUS:5', tarla: 'T9' })
    expect(p.parcele[1]).toMatchObject({ cheie_sursa: 'HUS|HG 6||', cheie: 'HUS:6' })
    expect(p.fara_cheie).toEqual([{ rand: 4, nr_crt: '5', nume: 'Test Fără Cheie', cheie_parcela: 'HUS:5' }])
    expect(p.statistici).toMatchObject({ parcele_fara_cheie: 1, fara_cheie: 1 })
    expect(p.erori).toEqual([])
  })
  it('P1-3: județ în adresă diferit de coloana Județ → adresa_judet din adresă + notă în observatii-le parcelei', () => {
    const p = parseazaTgz(xlsxDin([
      ['1', 'HG 1', 'HUS', 'Mehedinți', 'Test Alt Judet', 'Jud. Dolj, Mun. Craiova, Str. Q nr. 1', 1, 'arabil', 'T1', 'CF 1', 'privat'],
      ['2', 'HG 2', 'HUS', 'Mehedinți', 'Test Acelasi', 'Județul Mehedinți, Sat Peri', 1, 'arabil', 'T1', 'CF 2', ''],
    ]), OPT)
    expect(p.contacte[0]).toMatchObject({ adresa_judet: 'Dolj', judet_adresa: 'Dolj', adresa_comuna: 'Craiova', adresa_strada: 'Str. Q nr. 1' })
    expect(p.parcele[0].observatii).toBe('Regim juridic: privat; județ adresă ≠ județ teren (adresă: Dolj; teren: Mehedinți; rând 4)')
    expect(p.contacte[1]).toMatchObject({ adresa_judet: 'Mehedinți', adresa_sat: 'Peri' })
    expect(p.parcele[1].observatii).toBeNull()
    expect(p.statistici.judet_diferit).toBe(1)
  })
  it('UAT dat prin uat3 în fișier se recunoaște; tronson lipsă → eroare pe rând', () => {
    const p = parseazaTgz(xlsxDin([['1', '', 'PRU', 'MH', 'Test Fără Tronson', 'Str. A', 1, '', '', '', '']]), { ...OPT, tronsonPeUat: { HUS: 3 } })
    expect(p.parcele).toHaveLength(0)
    expect(p.erori[0].motiv).toMatch(/Tronson/)
  })
  it('fără antet → eroare, fără excepție', () => {
    const p = parseazaTgz(xlsxDin([['1', 'x']], { antet: ['A', 'B'] }), OPT)
    expect(p.parcele).toEqual([])
    expect(p.erori[0].motiv).toMatch(/antet/)
  })
  it('fișier care nu e Excel → eroare, fără excepție', () => {
    const p = parseazaTgz(new Uint8Array([1, 2, 3, 4]).buffer, OPT)
    expect(p.erori).toHaveLength(1)
    expect(p.statistici.erori).toBe(1)
  })
  it('rândurile goale dintre date se sar', () => {
    const p = parseazaTgz(xlsxDin([['1', 'HG 1', 'HUS', 'MH', 'Test A', 'Str. A', 1, '', '', '', ''], [], ['2', 'HG 2', 'HUS', 'MH', 'Test B', 'Str. B', 1, '', '', '', '']]), OPT)
    expect(p.parcele).toHaveLength(2)
    expect(p.statistici.randuri_goale).toBe(1)
  })
  it('performanță: 2.800 de rânduri fictive parsate sub 2 s', () => {
    const randuri = []
    for (let i = 1; i <= 2800; i++) {
      const x = i % 10 === 1 && i > 1 ? i - 1 : i          // rândul x/2 urmează rândului x/1
      const uat = x % 2 ? 'Husnicioara' : 'Prunișor'
      const nrCrt = i % 10 === 0 ? `${i}/1` : (x !== i ? `${x}/2` : String(i))
      randuri.push([nrCrt, `HG ${x}`, uat, 'Mehedinți', `Test Persoană ${i}`, i % 7 === 0 ? '' : `Sat Fictiv ${i % 30}, Com. ${uat}, Str. Test nr. ${i}`, i * 1.5, 'arabil', `T${x % 40}`, `CF ${1000 + x}`, 'privat'])
    }
    const buf = xlsxDin(randuri)
    const t0 = performance.now()
    const p = parseazaTgz(buf, OPT)
    const durata = performance.now() - t0
    expect(p.statistici.randuri_total).toBe(2800)
    expect(p.erori).toEqual([])
    expect(p.detinatori).toHaveLength(2800)
    expect(p.parcele.length).toBeLessThan(2800)  // coproprietarii x/1, x/2 împart parcela
    expect(p.ambigue).toEqual([]); expect(p.fara_cheie).toEqual([])
    expect(durata).toBeLessThan(2000)
  })
})

// ───────── fake supabase: înregistrează apelurile (inclusiv mărimea .in() și paginile .range()), rpc rezervă numere ─────────
function creeazaFakeSupabase({ esueazaLa = null, esueazaLaLot = null, esueazaMarcareEsuat = false, numereInitiale = {} } = {}) {
  const tabele = { red_parcele: [], red_detinatori: [], red_detinatori_contact: [], red_import_loturi: [] }
  const apeluri = []
  const numere = { ...numereInitiale }   // 'HUS|3' → ultimul rezervat
  const contorInsert = {}
  let nr = 0
  const uuid = () => `uuid-${++nr}`
  const stare = { esueazaLa, esueazaLaLot, esueazaMarcareEsuat }

  class Query {
    constructor(tabel) { this.tabel = tabel; this.op = null; this.filtre = []; this.randuri = null; this.unRand = false; this.interval = null }
    insert(randuri) { this.op = 'insert'; this.randuri = Array.isArray(randuri) ? randuri : [randuri]; this.apel = { op: 'insert', tabel: this.tabel, n: this.randuri.length }; apeluri.push(this.apel); return this }
    update(valori) { this.op = 'update'; this.valori = valori; this.apel = { op: 'update', tabel: this.tabel, valori }; apeluri.push(this.apel); return this }
    select(col) { if (!this.op) { this.op = 'select'; this.apel = { op: 'select', tabel: this.tabel, in: 0, pagini: 0 }; apeluri.push(this.apel) } this.col = col; return this }
    eq(c, v) { this.filtre.push(r => r[c] === v); return this }
    in(c, lista) { const s = new Set(lista); if (this.apel) this.apel.in = lista.length; this.filtre.push(r => s.has(r[c])); return this }
    is(c, v) { this.filtre.push(r => (v === null ? r[c] == null : r[c] === v)); return this }
    range(a, b) { this.interval = [a, b]; if (this.apel) { this.apel.pagini++; this.apel.de_la = a } return this }
    single() { this.unRand = true; return this }
    _exec() {
      const t = tabele[this.tabel]
      if (!t) return { data: null, error: { message: `tabel necunoscut ${this.tabel}` } }
      if (this.op === 'insert') {
        contorInsert[this.tabel] = (contorInsert[this.tabel] ?? 0) + 1
        if (stare.esueazaLa && stare.esueazaLa === this.tabel) return { data: null, error: { message: `eșec simulat la ${this.tabel}` } }
        if (stare.esueazaLaLot && stare.esueazaLaLot.tabel === this.tabel && stare.esueazaLaLot.lot === contorInsert[this.tabel]) return { data: null, error: { message: `eșec simulat la ${this.tabel}, lotul ${contorInsert[this.tabel]}` } }
        const inserate = this.randuri.map(r => ({ id: uuid(), sters_la: null, ...r }))
        t.push(...inserate)
        if (this.col) return { data: this.unRand ? inserate[0] : inserate, error: null }
        return { data: null, error: null }
      }
      if (this.op === 'update') {
        if (stare.esueazaMarcareEsuat && this.valori?.stare === 'esuat') return { data: null, error: { message: 'conexiune pierdută' } }
        const tinta = t.filter(r => this.filtre.every(f => f(r)))
        for (const r of tinta) Object.assign(r, this.valori)
        return { data: this.col ? tinta : null, error: null }
      }
      let data = t.filter(r => this.filtre.every(f => f(r)))
      if (this.interval) data = data.slice(this.interval[0], this.interval[1] + 1)
      return { data: this.unRand ? data[0] ?? null : data, error: null }
    }
    then(ok, ko) { return Promise.resolve(this._exec()).then(ok, ko) }
  }
  const rpc = async (nume, args) => {
    apeluri.push({ op: 'rpc', nume, args })
    if (nume !== RPC_REZERVA_NUMERE) return { data: null, error: { message: `rpc necunoscut ${nume}` } }
    const k = `${args.p_uat3}|${args.p_tronson}`
    const start = (numere[k] ?? 0) + 1
    numere[k] = start + args.p_n - 1
    return { data: start, error: null }
  }
  return { from: tabel => new Query(tabel), rpc, tabele, apeluri, stare, numere }
}

function previewMare(n) {
  const parcele = []; const detinatori = []; const contacte = []
  for (let i = 1; i <= n; i++) {
    const cheie = `HUS:${i}`
    const cheie_sursa = `HUS|HG ${i}|CF ${1000 + i}|T${i % 40}`
    parcele.push({ cheie, cheie_sursa, ambigua: false, nr_crt: i, uat_id: 'uuid-hus', uat3: 'HUS', id_parcela: 'T3-HUS-????', nr_provizoriu: i, tronson: 3, poz_hg: `HG ${i}`, suprafata_temporara_mp: i, categoria_folosinta: 'arabil', tarla: `T${i % 40}`, nr_cadastral: `CF ${1000 + i}`, observatii: null, rand: 3 + i, nr_detinatori: 1 })
    const cheieDet = `${cheie}|TEST PERSOANA ${i}`
    detinatori.push({ cheie: cheieDet, cheie_parcela: cheie, id_parcela: 'T3-HUS-????', nr_crt: String(i), nume: `Test Persoana ${i}`, nume_normalizat: `TEST PERSOANA ${i}`, calitate: 'proprietar', cota: null, sursa_date: 'TGZ', versiune_lista_tgz: 'v1', rand: 3 + i })
    contacte.push({ cheie_detinator: cheieDet, adresa_strada: `Str. ${i}`, adresa_sat: null, adresa_comuna: null, adresa_judet: 'Mehedinți', judet_adresa: null, cod_postal: null, adresa_cunoscuta: true })
  }
  return { parcele, detinatori, contacte, dubluri: [], neidentificati: [], fara_cheie: [], ambigue: [], erori: [], statistici: { randuri_total: n } }
}

const secventa = sb => sb.apeluri.map(a => (a.op === 'rpc' ? `rpc:${a.nume}` : `${a.op}:${a.tabel}`))
const selecturi = sb => sb.apeluri.filter(a => a.op === 'select')
const updateuriLot = sb => sb.apeluri.filter(a => a.op === 'update' && a.tabel === 'red_import_loturi').map(a => a.valori)
const fara = r => { const { id, detinator_id, parcela_id, ...rest } = r; return rest }

describe('scrieImport — fake supabase', () => {
  it('scrie preview-ul real: lot in_curs → parcele (numere rezervate prin RPC) → detinatori → contact → lot finalizat, cu UPDATE-uri intermediare', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase()
    const progres = []
    const r = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'TGZ 13.07.2026', sursa: 'TGZ', fisierNume: 'fictiv.xlsx', onProgress: e => progres.push(e) })

    expect(r).toMatchObject({ parceleNoi: 8, parceleRefolosite: 0, detinatoriNoi: 9, detinatoriExistenti: 0, contacteNoi: 9, existente: [], fara_cheie: [], ambigue: [] })
    expect(r.lotId).toMatch(/^uuid-/)
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
    expect(sb.tabele.red_import_loturi).toHaveLength(1)

    // id-urile finale vin din RPC: HUS 1..7, PRU 1
    expect(sb.tabele.red_parcele.filter(p => p.uat_id === 'uuid-hus').map(p => p.id_parcela)).toEqual(['T3-HUS-0001', 'T3-HUS-0002', 'T3-HUS-0003', 'T3-HUS-0004', 'T3-HUS-0005', 'T3-HUS-0006', 'T3-HUS-0007'])
    expect(sb.tabele.red_parcele.find(p => p.uat_id === 'uuid-pru').id_parcela).toBe('T2-PRU-0001')
    expect(sb.apeluri.filter(a => a.op === 'rpc').map(a => a.args)).toEqual([{ p_uat3: 'HUS', p_tronson: 3, p_n: 7 }, { p_uat3: 'PRU', p_tronson: 2, p_n: 1 }])
    expect(sb.tabele.red_parcele[0]).toMatchObject({ proiect_id: 'proiect-1', uat_id: 'uuid-hus', tronson: 3, id_parcela: 'T3-HUS-0001', cheie_sursa: 'HUS|HG 1|CF 1001|T12' })
    expect(sb.tabele.red_parcele.every(p => !p.id_parcela.includes('?'))).toBe(true)

    // legături: coproprietarii pointează la uuid-ul parcelei T3-HUS-0003; contactul la uuid-ul deținătorului
    const p7 = sb.tabele.red_parcele.find(p => p.id_parcela === 'T3-HUS-0003')
    const cop = sb.tabele.red_detinatori.filter(d => d.parcela_id === p7.id)
    expect(cop.map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar'])
    const dNeid = sb.tabele.red_detinatori.find(d => d.calitate === 'neidentificat')
    expect(sb.tabele.red_detinatori_contact.find(c => c.detinator_id === dNeid.id).adresa_cunoscuta).toBe(false)
    expect(sb.tabele.red_detinatori[0]).toMatchObject({ nume: 'Test Proprietar Unu', versiune_lista_tgz: 'TGZ 13.07.2026', sursa_date: 'TGZ' })
    // contactul nu duce coloane străine (judet_adresa rămâne în preview)
    expect(Object.keys(sb.tabele.red_detinatori_contact[0]).sort()).toEqual(['adresa_comuna', 'adresa_cunoscuta', 'adresa_judet', 'adresa_sat', 'adresa_strada', 'cod_postal', 'detinator_id', 'email', 'id', 'sters_la', 'telefon'])

    // lotul: creat întâi 'in_curs', contoarele după fiecare etapă, la final 'finalizat'
    const lot = sb.tabele.red_import_loturi[0]
    expect(lot).toMatchObject({ id: r.lotId, proiect_id: 'proiect-1', versiune_lista_tgz: 'TGZ 13.07.2026', sursa: 'TGZ', fisier_nume: 'fictiv.xlsx', randuri_total: 12, stare: 'finalizat', eroare: null, parcele_noi: 8, detinatori_noi: 9, dubluri: 1, neidentificati: 1 })
    expect(lot.contacte_noi).toBeUndefined()   // tabela n-are coloana: contorul stă în diferente
    expect(lot.diferente).toMatchObject({ contacte_noi: 9, existente: [], parcele_refolosite: 0, detinatori_existenti: 0, fara_cheie: [], ambigue: [] })
    expect(lot.diferente.erori).toHaveLength(2)
    expect(updateuriLot(sb)).toEqual([
      { parcele_noi: 8 }, { detinatori_noi: 9 }, { diferente: expect.objectContaining({ contacte_noi: 9 }) },
      expect.objectContaining({ stare: 'finalizat', parcele_noi: 8, detinatori_noi: 9, diferente: expect.objectContaining({ contacte_noi: 9 }) }),
    ])

    expect(secventa(sb)).toEqual([
      'insert:red_import_loturi',
      'select:red_parcele',            // existente pe cheie_sursa
      `rpc:${RPC_REZERVA_NUMERE}`, `rpc:${RPC_REZERVA_NUMERE}`,
      'insert:red_parcele', 'select:red_parcele', 'update:red_import_loturi',
      'insert:red_detinatori', 'select:red_detinatori', 'update:red_import_loturi',
      'insert:red_detinatori_contact', 'update:red_import_loturi',
      'update:red_import_loturi',
    ])
    expect(progres.map(e => e.etapa)).toEqual(['parcele', 'detinatori', 'contacte', 'gata'])
  })

  it('P2-8: loturi de 200 la INSERT, max 100 id-uri per .in() la citiri, .range() paginat; 450 parcele → 3 loturi per tabel', async () => {
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, previewMare(450), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 450, detinatoriNoi: 450, contacteNoi: 450 })
    const ins = tabel => sb.apeluri.filter(a => a.op === 'insert' && a.tabel === tabel).map(a => a.n)
    expect(ins('red_parcele')).toEqual([200, 200, 50])
    expect(ins('red_detinatori')).toEqual([200, 200, 50])
    expect(ins('red_detinatori_contact')).toEqual([200, 200, 50])
    expect(ins('red_import_loturi')).toEqual([1])
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toEqual([{ op: 'rpc', nume: RPC_REZERVA_NUMERE, args: { p_uat3: 'HUS', p_tronson: 3, p_n: 450 } }])
    expect(sb.tabele.red_parcele[449].id_parcela).toBe('T3-HUS-0450')
    expect(LOT).toBe(200); expect(LOT_CITIRE).toBe(100)
    expect(selecturi(sb).every(a => a.in <= 100 && a.pagini >= 1)).toBe(true)
    // existență: 450 chei → 5 selecturi; citiri id după insert: 200→2, 200→2, 50→1
    expect(selecturi(sb).filter(a => a.tabel === 'red_parcele').map(a => a.in)).toEqual([100, 100, 100, 100, 50, 100, 100, 100, 100, 50])
    const idx = (op, tabel, ultimul = false) => { const l = sb.apeluri.map((a, i) => (a.op === op && a.tabel === tabel ? i : -1)).filter(i => i >= 0); return ultimul ? l[l.length - 1] : l[0] }
    expect(idx('insert', 'red_import_loturi')).toBe(0)
    expect(idx('insert', 'red_parcele', true)).toBeLessThan(idx('insert', 'red_detinatori'))
    expect(idx('insert', 'red_detinatori', true)).toBeLessThan(idx('insert', 'red_detinatori_contact'))
    expect(idx('insert', 'red_detinatori_contact', true)).toBeLessThan(idx('update', 'red_import_loturi', true))
    const ids = new Set(sb.tabele.red_detinatori.map(d => d.id))
    expect(sb.tabele.red_detinatori_contact.every(c => ids.has(c.detinator_id))).toBe(true)
  })

  it('P1-1 reimportul aceluiași fișier NU duplică: parcelele existente (cheie_sursa) se refolosesc, numerotarea nu avansează', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase()
    await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 0, detinatoriExistenti: 9, contacteNoi: 0 })
    expect(r2.existente.sort()).toEqual(['T2-PRU-0001', 'T3-HUS-0001', 'T3-HUS-0002', 'T3-HUS-0003', 'T3-HUS-0004', 'T3-HUS-0005', 'T3-HUS-0006', 'T3-HUS-0007'])
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
    expect(sb.tabele.red_import_loturi).toHaveLength(2)
    expect(sb.tabele.red_import_loturi[1]).toMatchObject({ stare: 'finalizat', parcele_noi: 0, detinatori_noi: 0, versiune_lista_tgz: 'v2', diferente: expect.objectContaining({ contacte_noi: 0 }) })
    expect(sb.numere['HUS|3']).toBe(7)   // niciun număr rezervat în plus
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toHaveLength(2)
  })

  it('P1-1 parcelă existentă + deținător nou pe ea: parcela se refolosește, deținătorul și contactul se adaugă', async () => {
    const sb = creeazaFakeSupabase()
    await scrieImport(sb, parseazaTgz(xlsxDin(RANDURI.slice(0, 2)), OPT), { proiectId: 'proiect-1', versiune: 'v1' })
    const randuriV2 = [...RANDURI.slice(0, 2), ['1/2', 'HG 1', 'Husnicioara', 'Mehedinți', 'Test Mostenitor Nou', 'Str. Nouă 1', '120,5', 'arabil', 'T12', 'CF 1001', 'privat']]
    const r2 = await scrieImport(sb, parseazaTgz(xlsxDin(randuriV2), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 2, detinatoriNoi: 1, detinatoriExistenti: 2, contacteNoi: 1 })
    const p1 = sb.tabele.red_parcele.find(p => p.id_parcela === 'T3-HUS-0001')
    expect(sb.tabele.red_parcele).toHaveLength(2)
    const dNou = sb.tabele.red_detinatori.find(d => d.nume === 'Test Mostenitor Nou')
    expect(dNou).toMatchObject({ parcela_id: p1.id, calitate: 'coproprietar', versiune_lista_tgz: 'v2' })
    expect(sb.tabele.red_detinatori_contact.find(c => c.detinator_id === dNou.id).adresa_strada).toBe('Str. Nouă 1')
  })

  it('P1-1 ambigue + P1-2 fără cheie: NU se comit, sunt raportate în rezultat și în lot; restul se scrie', async () => {
    const preview = parseazaTgz(xlsxDin([
      ['1', 'HG 1', 'HUS', 'MH', 'Test Ambiguu A', 'Str. A', 1, 'arabil', 'T1', 'CF 1', ''],
      ['2', 'HG 1', 'HUS', 'MH', 'Test Ambiguu B', 'Str. B', 1, 'arabil', 'T1', 'CF 1', ''],
      ['3', '', 'HUS', 'MH', 'Test Fără Cheie', 'Str. C', 1, 'arabil', 'T3', '', ''],
      ['4', 'HG 4', 'HUS', 'MH', 'Test Bun', 'Str. D', 1, 'arabil', 'T4', 'CF 4', ''],
    ]), OPT)
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1, detinatoriNoi: 1, contacteNoi: 1 })
    expect(r.ambigue).toEqual([{ rand: 4, nr_crt: '1', nume: 'Test Ambiguu A', motiv: MOTIV_AMBIGUU }, { rand: 5, nr_crt: '2', nume: 'Test Ambiguu B', motiv: MOTIV_AMBIGUU }])
    expect(r.fara_cheie).toEqual([{ rand: 6, nr_crt: '3', nume: 'Test Fără Cheie' }])
    expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['T3-HUS-0001'])
    expect(sb.tabele.red_detinatori.map(d => d.nume)).toEqual(['Test Bun'])
    expect(sb.apeluri.filter(a => a.op === 'rpc')[0].args.p_n).toBe(1)
    expect(sb.tabele.red_import_loturi[0].diferente).toMatchObject({ fara_cheie: r.fara_cheie, ambigue: r.ambigue })
    expect(sb.tabele.red_import_loturi[0].diferente.erori.filter(e => e.motiv === MOTIV_AMBIGUU)).toHaveLength(2)
    // reimportul nu creează nimic nou
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 1, detinatoriNoi: 0, contacteNoi: 0, fara_cheie: r.fara_cheie, ambigue: r.ambigue })
    expect(sb.tabele.red_parcele).toHaveLength(1)
  })

  it('P1-2 reluare după eroare la contacte: lotul 1 „esuat” cu mesaj (contoarele etapelor reușite rămân), lotul 2 completează doar ce lipsește', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_detinatori_contact' })
    await expect(scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare contacte: eșec simulat/)
    expect(sb.tabele.red_import_loturi).toHaveLength(1)
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', eroare: expect.stringMatching(/inserare contacte/), parcele_noi: 8, detinatori_noi: 9, diferente: expect.objectContaining({ contacte_noi: 0 }) })
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(0)

    sb.stare.esueazaLa = null
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 0, detinatoriExistenti: 9, contacteNoi: 9 })
    expect(sb.tabele.red_import_loturi[1]).toMatchObject({ stare: 'finalizat', eroare: null, diferente: expect.objectContaining({ contacte_noi: 9 }) })

    // aceeași stare finală ca un import reușit dintr-o bucată
    const ok = creeazaFakeSupabase()
    await scrieImport(ok, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(sb.tabele.red_parcele.map(fara)).toEqual(ok.tabele.red_parcele.map(fara))
    expect(sb.tabele.red_detinatori.map(fara)).toEqual(ok.tabele.red_detinatori.map(fara))
    expect(sb.tabele.red_detinatori_contact.map(fara)).toEqual(ok.tabele.red_detinatori_contact.map(fara))
    const idsDet = new Set(sb.tabele.red_detinatori.map(d => d.id))
    expect(sb.tabele.red_detinatori_contact.every(c => idsDet.has(c.detinator_id))).toBe(true)
  })

  it('P2-8 reluare cu >100 parcele existente: citirile în loturi ≤100 și paginate (pagina 40), stare finală identică', async () => {
    const preview = previewMare(250)
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_detinatori_contact' })
    await expect(scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1', pagina: 40 })).rejects.toThrow(/inserare contacte/)
    expect(sb.tabele.red_parcele).toHaveLength(250); expect(sb.tabele.red_detinatori).toHaveLength(250)
    sb.stare.esueazaLa = null
    sb.apeluri.length = 0
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1', pagina: 40 })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 250, detinatoriNoi: 0, detinatoriExistenti: 250, contacteNoi: 250 })
    const sel = selecturi(sb)
    expect(sel.every(a => a.in <= 100)).toBe(true)
    // 250 chei → loturi 100/100/50; fiecare lot de 100 se citește în 3 pagini de 40 (0-39, 40-79, 80-119), lotul de 50 în 2 — un query per pagină
    const pagini = [[100, 0], [100, 40], [100, 80], [100, 0], [100, 40], [100, 80], [50, 0], [50, 40]]
    expect(sel.filter(a => a.tabel === 'red_parcele').map(a => [a.in, a.de_la])).toEqual(pagini)
    expect(sel.filter(a => a.tabel === 'red_detinatori').map(a => [a.in, a.de_la])).toEqual(pagini)
    expect(sel.every(a => a.pagini === 1)).toBe(true)
    expect(sel.filter(a => a.tabel === 'red_detinatori_contact').map(a => a.in)).toEqual([100, 100, 50])
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toEqual([])
    expect(sb.tabele.red_parcele).toHaveLength(250); expect(sb.tabele.red_detinatori).toHaveLength(250); expect(sb.tabele.red_detinatori_contact).toHaveLength(250)

    const ok = creeazaFakeSupabase()
    await scrieImport(ok, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(sb.tabele.red_detinatori_contact.map(fara)).toEqual(ok.tabele.red_detinatori_contact.map(fara))
    const idsDet = new Set(sb.tabele.red_detinatori.map(d => d.id))
    expect(sb.tabele.red_detinatori_contact.every(c => idsDet.has(c.detinator_id))).toBe(true)
  })

  it('P1-2 reluare după eroare la deținători: parcelele deja scrise se refolosesc, deținătorii și contactele se completează', async () => {
    const preview = parseazaTgz(xlsxDin(RANDURI), OPT)
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_detinatori' })
    await expect(scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare deținători/)
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(0)
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 8, detinatori_noi: 0 })
    sb.stare.esueazaLa = null
    const r2 = await scrieImport(sb, preview, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 8, detinatoriNoi: 9, contacteNoi: 9 })
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
  })

  it('P2-1: contoarele se actualizează după FIECARE lot de 200; eșec la al doilea lot de parcele → lot esuat cu parcele_noi = 200', async () => {
    const sb = creeazaFakeSupabase({ esueazaLaLot: { tabel: 'red_parcele', lot: 2 } })
    await expect(scrieImport(sb, previewMare(450), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare parcele: eșec simulat la red_parcele, lotul 2/)
    expect(sb.tabele.red_parcele).toHaveLength(200)
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 200, detinatori_noi: 0, eroare: expect.stringMatching(/lotul 2/), diferente: expect.objectContaining({ contacte_noi: 0 }) })
    expect(updateuriLot(sb)).toEqual([{ parcele_noi: 200 }, expect.objectContaining({ stare: 'esuat', parcele_noi: 200, detinatori_noi: 0 })])

    // același preview, fără eșec: câte un UPDATE după fiecare lot, pe fiecare etapă
    const ok = creeazaFakeSupabase()
    await scrieImport(ok, previewMare(450), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(updateuriLot(ok)).toEqual([
      { parcele_noi: 200 }, { parcele_noi: 400 }, { parcele_noi: 450 },
      { detinatori_noi: 200 }, { detinatori_noi: 400 }, { detinatori_noi: 450 },
      { diferente: expect.objectContaining({ contacte_noi: 200 }) }, { diferente: expect.objectContaining({ contacte_noi: 400 }) }, { diferente: expect.objectContaining({ contacte_noi: 450 }) },
      expect.objectContaining({ stare: 'finalizat', parcele_noi: 450, detinatori_noi: 450, diferente: expect.objectContaining({ contacte_noi: 450 }) }),
    ])
    // eșec la al doilea lot de contacte: cifrele parcelelor/deținătorilor rămân pe lotul esuat
    const sb2 = creeazaFakeSupabase({ esueazaLaLot: { tabel: 'red_detinatori_contact', lot: 2 } })
    await expect(scrieImport(sb2, previewMare(450), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/inserare contacte/)
    expect(sb2.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 450, detinatori_noi: 450, diferente: expect.objectContaining({ contacte_noi: 200 }) })
  })

  it('P2-8: dacă rezervarea ar depăși 9999 pe un UAT → oprire ÎNAINTE de orice INSERT, lot esuat cu 0 scrieri', async () => {
    const sb = creeazaFakeSupabase({ numereInitiale: { 'HUS|3': 9990 } })
    await expect(scrieImport(sb, previewMare(15), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/UAT HUS \/ tronson T3 ar depăși 9999 \(15 parcele noi de la 9991 → 10005\); nimic nu a fost scris/)
    expect(sb.tabele.red_parcele).toHaveLength(0); expect(sb.tabele.red_detinatori).toHaveLength(0); expect(sb.tabele.red_detinatori_contact).toHaveLength(0)
    expect(sb.apeluri.filter(a => a.op === 'insert').map(a => a.tabel)).toEqual(['red_import_loturi'])
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 0, detinatori_noi: 0, eroare: expect.stringMatching(/9999/) })
    // exact 9999 e în regulă
    const ok = creeazaFakeSupabase({ numereInitiale: { 'HUS|3': 9990 } })
    const r = await scrieImport(ok, previewMare(9), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.parceleNoi).toBe(9)
    expect(ok.tabele.red_parcele[8].id_parcela).toBe('T3-HUS-9999')
  })

  it('eroarea de la BD oprește scrierea, marchează lotul „esuat” și poartă lotId', async () => {
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_parcele' })
    let eroare
    try { await scrieImport(sb, previewMare(3), { proiectId: 'proiect-1', versiune: 'v1' }) } catch (e) { eroare = e }
    expect(eroare.message).toMatch(/inserare parcele: eșec simulat/)
    expect(eroare.lotId).toBe(sb.tabele.red_import_loturi[0].id)
    expect(eroare.lotNeinchis).toBeUndefined()
    expect(sb.tabele.red_import_loturi[0].stare).toBe('esuat')
    // numerele rezervate rămân consumate (fără refolosire, ca la red_numere)
    expect(sb.numere['HUS|3']).toBe(3)
  })

  it('P2-4: dacă nici marcarea „esuat” nu reușește, eroarea NU se înghite: mesaj extins + e.lotNeinchis', async () => {
    const sb = creeazaFakeSupabase({ esueazaLa: 'red_parcele', esueazaMarcareEsuat: true })
    let eroare
    try { await scrieImport(sb, previewMare(2), { proiectId: 'proiect-1', versiune: 'v1' }) } catch (e) { eroare = e }
    expect(eroare.lotNeinchis).toBe(true)
    expect(eroare.lotId).toBe(sb.tabele.red_import_loturi[0].id)
    expect(eroare.message).toMatch(/inserare parcele: eșec simulat.*a rămas „in_curs”.*conexiune pierdută/)
    expect(sb.tabele.red_import_loturi[0].stare).toBe('in_curs')
  })

  it('RPC-ul care întoarce un rând/obiect e acceptat; un început invalid → eroare clară', async () => {
    const sb = creeazaFakeSupabase()
    const rpcVechi = sb.rpc
    sb.rpc = async (n, a) => { const r = await rpcVechi(n, a); return { data: [{ start: r.data }], error: null } }
    const r = await scrieImport(sb, previewMare(2), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.parceleNoi).toBe(2)
    expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['T3-HUS-0001', 'T3-HUS-0002'])

    const sb2 = creeazaFakeSupabase()
    sb2.rpc = async () => ({ data: null, error: null })
    await expect(scrieImport(sb2, previewMare(1), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/început invalid/)
    expect(sb2.tabele.red_import_loturi[0].stare).toBe('esuat')
  })

  it('fără proiectId → eroare înainte de orice scriere', async () => {
    const sb = creeazaFakeSupabase()
    await expect(scrieImport(sb, previewMare(1), {})).rejects.toThrow(/proiectId/)
    expect(sb.apeluri).toEqual([])
  })
})
