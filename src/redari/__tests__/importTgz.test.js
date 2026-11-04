import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { readFileSync } from 'node:fs'
import { parseazaTgz, scrieImport, parseazaNrCrt, imparteAdresa, cheieSursa, cadastruGol, cadastruSuspect, randuriDeTratat, numarRanduriPuseDeoparte, csvRanduriDeTratat,
  LOT, LOT_CITIRE, RPC_REZERVA_NUMERE, MOTIV_AMBIGUU, MOTIV_CONTRADICTORIU, MOTIV_CADASTRU_SUSPECT, MOTIV_NRCRT_INCOMPATIBIL, STARE_ELIGIBILA, STARE_NECONFIRMATA,
  RE_NR_CRT_GRUP_SQL, NR_CRT_GRUP_MAX, grupNrCrtValid } from '../importTgz.js'

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
    expect(parseazaNrCrt('7/2')).toEqual({ x: 7, sub: null, y: 2, grup: '7', punct_fara_slash: false })
    expect(parseazaNrCrt(' 7 / 1 ')).toEqual({ x: 7, sub: null, y: 1, grup: '7', punct_fara_slash: false })
    expect(parseazaNrCrt('12')).toEqual({ x: 12, sub: null, y: null, grup: '12', punct_fara_slash: false })
    expect(parseazaNrCrt(12)).toEqual({ x: 12, sub: null, y: null, grup: '12', punct_fara_slash: false })
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
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.id_parcela)).toEqual(Array(7).fill('HUS-????'))
    expect(p.parcele.filter(x => x.uat3 === 'HUS').map(x => x.nr_provizoriu)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(p.parcele.find(x => x.uat3 === 'PRU')).toMatchObject({ cheie: 'PRU:12', id_parcela: 'PRU-????', nr_provizoriu: 1, tronson: 2, uat_id: 'uuid-pru', cheie_sursa: 'PRU|HG 12|CF 2001|T2', ambigua: false })
    expect(p.parcele[0]).toMatchObject({ cheie: 'HUS:1', cheie_sursa: 'HUS|HG 1|CF 1001|T12', ambigua: false, nr_crt: 1, uat_id: 'uuid-hus', tronson: 3, poz_hg: 'HG 1', suprafata_temporara_mp: 120.5, categoria_folosinta: 'arabil', tarla: 'T12', nr_cadastral: 'CF 1001', observatii: 'Regim juridic: privat' })
    expect(p.statistici).toMatchObject({ parcele_fara_cheie: 0, parcele_ambigue: 0, fara_cheie: 0, ambigue: 0, judet_diferit: 0 })
    expect(p.fara_cheie).toEqual([]); expect(p.ambigue).toEqual([])
  })
  it('idStart e ignorat (compatibilitate)', () => {
    const p2 = parseazaTgz(xlsxDin(RANDURI), { ...OPT, idStart: { HUS: 500 } })
    expect(p2.parcele[0].id_parcela).toBe('HUS-????')
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
    expect(p.statistici).toMatchObject({ parcele: 8, detinatori: 9, contacte: 9, dubluri: 1, neidentificati: 1, erori: 2, parcele_de_importat: 8, detinatori_de_importat: 9, contacte_de_importat: 9 })
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
    expect(p.detinatori[0]).toMatchObject({ nume: 'Test Antet', id_parcela: 'HUS-????' })
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
    // 04.11.2026 (pct. 1): rândurile ambigue apar O SINGURĂ DATĂ — în ambigue, nu și în erori
    expect(p.erori).toEqual([])
    expect(p.ambigue).toEqual([
      { rand: 4, nr_crt: '1', nume: 'Test A', uat: 'HUS', cheie_parcela: 'HUS:1', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU },
      { rand: 5, nr_crt: '2', nume: 'Test B', uat: 'HUS', cheie_parcela: 'HUS:2', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU },
    ])
    expect(p.statistici).toMatchObject({ parcele_ambigue: 2, ambigue: 2, erori: 0, randuri_de_tratat: 2 })
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
    expect(p.erori).toEqual([])
    expect(p.ambigue[1].detaliu).toBe('cadastru: „CF 1007” / „CF 1008”')
    expect(p.ambigue[3].detaliu).toBe('tarla: „T30” / „T31”')
    expect(p.ambigue[0].detaliu).toBe('cadastru: „CF 1007” / „CF 1008”')
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
  it('P1-2 (r6, exemplul Jakarinos): contradicția se vede pe TOT grupul — 7/1 HG1/gol, 7/2 HG1/100, 7/3 HG1/200 ⇒ ambiguă; dublura de nume intră și ea în ambigue (P2-2)', async () => {
    const p = parseazaTgz(xlsxDin([
      ['7/1', 'HG 1', 'HUS', 'MH', 'Test Grup Unu', 'Str. A', 1, 'arabil', 'T5', '', ''],
      ['7/2', 'HG 1', 'HUS', 'MH', 'Test Grup Doi', 'Str. B', 1, 'arabil', 'T5', '100', ''],
      ['7/3', 'HG 1', 'HUS', 'MH', 'Test Grup Trei', 'Str. C', 1, 'arabil', 'T5', '200', ''],
      ['7/4', 'HG 1', 'HUS', 'MH', 'TEST GRUP DOI', 'Str. B', 1, 'arabil', '', '100', ''],   // dublură de nume (același grup) → tot în ambigue
      ['8/1', 'HG 8', 'HUS', 'MH', 'Test Ok Unu', 'Str. D', 1, 'arabil', 'T6', '300', ''],
      ['8/2', '', 'HUS', 'MH', 'Test Ok Doi', 'Str. E', 1, 'arabil', '', '300', ''],          // valori egale sau goale → OK
    ]), OPT)
    expect(p.parcele.map(x => [x.cheie, x.ambigua, x.motiv_ambiguitate])).toEqual([['HUS:7', true, MOTIV_CONTRADICTORIU], ['HUS:8', false, null]])
    expect(p.parcele[0]).toMatchObject({ nr_cadastral: '100', cheie_sursa: 'HUS|HG 1|100|T5', randuri: expect.any(Array) })   // consolidat: prima valoare nevidă
    expect(p.parcele[0].valori).toBeUndefined(); expect(p.parcele[0].note).toBeUndefined()
    expect(p.statistici).toMatchObject({ parcele_de_importat: 1, detinatori_de_importat: 2, contacte_de_importat: 2 })
    expect(p.dubluri).toHaveLength(1)
    expect(p.detinatori.filter(d => d.cheie_parcela === 'HUS:7')).toHaveLength(3)
    // toate cele 4 rânduri ale grupului (și dublura) în ambigue (o singură dată — nu și în erori), cu detaliul câmpului contradictoriu
    expect(p.erori).toEqual([])
    expect(p.ambigue.map(a => [a.rand, a.nr_crt, a.nume, a.detaliu])).toEqual([
      [4, '7/1', 'Test Grup Unu', 'cadastru: „100” / „200”'], [5, '7/2', 'Test Grup Doi', 'cadastru: „100” / „200”'],
      [6, '7/3', 'Test Grup Trei', 'cadastru: „100” / „200”'], [7, '7/4', 'TEST GRUP DOI', 'cadastru: „100” / „200”'],
    ])
    expect(p.statistici).toMatchObject({ parcele: 2, parcele_ambigue: 1, ambigue: 4, dubluri: 1, detinatori: 5 })
    expect(p.statistici.pe_uat.HUS.ambigue).toBe(4)
    // commit: doar parcela 8; rezultatul raportează toate cele 4 rânduri
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, p, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1, detinatoriNoi: 2, contacteNoi: 2 })
    expect(r.ambigue.map(a => [a.rand, a.nume, a.motiv, a.detaliu])).toEqual([
      [4, 'Test Grup Unu', MOTIV_CONTRADICTORIU, 'cadastru: „100” / „200”'], [5, 'Test Grup Doi', MOTIV_CONTRADICTORIU, 'cadastru: „100” / „200”'],
      [6, 'Test Grup Trei', MOTIV_CONTRADICTORIU, 'cadastru: „100” / „200”'], [7, 'TEST GRUP DOI', MOTIV_CONTRADICTORIU, 'cadastru: „100” / „200”'],
    ])
    expect(sb.tabele.red_import_loturi[0].diferente.ambigue).toHaveLength(4)
    // două câmpuri contradictorii → ambele în detaliu
    const p2 = parseazaTgz(xlsxDin([
      ['1/1', 'HG 1', 'HUS', 'MH', 'Test X', 'Str. A', 1, '', 'T1', 'CF 1', ''],
      ['1/2', 'HG 2', 'HUS', 'MH', 'Test Y', 'Str. B', 1, '', 'T2', 'CF 1', ''],
    ]), OPT)
    expect(p2.ambigue[0].detaliu).toBe('HG: „HG 1” / „HG 2”; tarla: „T1” / „T2”')
  })
  it('P1-2 (r7): identitatea se consolidează pe grup ÎNAINTE de cheie — ordinea rândurilor nu schimbă cheie_sursa; reimportul în altă ordine ⇒ 0 noi', async () => {
    const a = [
      ['7/1', 'HG 1', 'HUS', 'MH', 'Test Unu', 'Str. A', 300, '', 'T5', '', 'privat'],
      ['7/2', 'HG 1', 'HUS', 'MH', 'Test Doi', 'Str. B', '', 'arabil', '', '100', ''],
    ]
    const b = [a[1], a[0]]
    const pa = parseazaTgz(xlsxDin(a), OPT); const pb = parseazaTgz(xlsxDin(b), OPT)
    for (const p of [pa, pb]) {
      expect(p.erori).toEqual([]); expect(p.ambigue).toEqual([])
      expect(p.parcele).toHaveLength(1)
      expect(p.parcele[0]).toMatchObject({ cheie: 'HUS:7', cheie_sursa: 'HUS|HG 1|100|T5', poz_hg: 'HG 1', nr_cadastral: '100', tarla: 'T5', suprafata_temporara_mp: 300, categoria_folosinta: 'arabil', observatii: 'Regim juridic: privat', ambigua: false })
      expect(p.statistici).toMatchObject({ parcele_de_importat: 1, detinatori_de_importat: 2, contacte_de_importat: 2, parcele_fara_cheie: 0 })
    }
    expect(pb.parcele[0].rand).toBe(4)   // rândul primei apariții
    const sb = creeazaFakeSupabase()
    const r1 = await scrieImport(sb, pa, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r1).toMatchObject({ parceleNoi: 1, detinatoriNoi: 2 })
    expect(sb.tabele.red_parcele[0]).toMatchObject({ cheie_sursa: 'HUS|HG 1|100|T5', nr_cadastral: '100', tarla: 'T5', suprafata_temporara_mp: 300 })
    const r2 = await scrieImport(sb, pb, { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 1, detinatoriNoi: 0, detinatoriExistenti: 2, contacteNoi: 0 })
    expect(sb.tabele.red_parcele).toHaveLength(1); expect(sb.tabele.red_detinatori).toHaveLength(2)
  })
  it('P1-2 (r7): suprafața / categoria / regimul contradictorii în grup ⇒ ambiguă, cu detaliu', () => {
    const p = parseazaTgz(xlsxDin([
      ['7/1', 'HG 1', 'HUS', 'MH', 'Test Unu', 'Str. A', '300', 'arabil', 'T5', '100', 'privat'],
      ['7/2', 'HG 1', 'HUS', 'MH', 'Test Doi', 'Str. B', '250,5', 'Arabil', 'T5', '100', 'Privat'],
    ]), OPT)
    expect(p.parcele[0]).toMatchObject({ ambigua: true, motiv_ambiguitate: MOTIV_CONTRADICTORIU, detaliu_ambiguitate: 'suprafață: „300” / „250.5”', cheie_sursa: 'HUS|HG 1|100|T5', suprafata_temporara_mp: 300 })
    expect(p.ambigue.map(a => a.rand)).toEqual([4, 5])
    expect(p.statistici).toMatchObject({ parcele_de_importat: 0, detinatori_de_importat: 0, contacte_de_importat: 0 })
  })
  it('P1-1 (r7): coliziune pe cheia CONSOLIDATĂ — grupul 7 (HG1/gol + HG1/100) și grupul 8 (HG1/100) ⇒ ambele grupuri ambigue', async () => {
    const p = parseazaTgz(xlsxDin([
      ['7/1', 'HG 1', 'HUS', 'MH', 'Test G7 Unu', 'Str. A', 1, '', '', '', ''],
      ['7/2', 'HG 1', 'HUS', 'MH', 'Test G7 Doi', 'Str. B', 1, '', '', '100', ''],
      ['8', 'HG 1', 'HUS', 'MH', 'Test G8', 'Str. C', 1, '', '', '100', ''],
      ['9', 'HG 9', 'HUS', 'MH', 'Test G9', 'Str. D', 1, '', '', '900', ''],
    ]), OPT)
    expect(p.parcele.map(x => [x.cheie, x.cheie_sursa, x.ambigua, x.motiv_ambiguitate])).toEqual([
      ['HUS:7', 'HUS|HG 1|100|', true, MOTIV_AMBIGUU], ['HUS:8', 'HUS|HG 1|100|', true, MOTIV_AMBIGUU], ['HUS:9', 'HUS|HG 9|900|', false, null],
    ])
    expect(p.erori).toEqual([])
    expect(p.ambigue.map(a => [a.rand, a.cheie_parcela])).toEqual([[4, 'HUS:7'], [5, 'HUS:7'], [6, 'HUS:8']])
    expect(p.statistici).toMatchObject({ parcele: 3, parcele_ambigue: 2, ambigue: 3, parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1 })
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, p, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1, detinatoriNoi: 1 })
    expect(sb.tabele.red_parcele.map(x => x.cheie_sursa)).toEqual(['HUS|HG 9|900|'])
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
    expect(p.fara_cheie).toEqual([{ rand: 4, nr_crt: '5', nume: 'Test Fără Cheie', uat: 'HUS', cheie_parcela: 'HUS:5' }])
    expect(p.statistici).toMatchObject({ parcele_fara_cheie: 1, fara_cheie: 1, parcele_de_importat: 1, detinatori_de_importat: 1, contacte_de_importat: 1 })
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
  it('UAT dat prin uat3 în fișier se recunoaște; tronson lipsă → parcelă cu tronson NULL (felia 8b, se atribuie ulterior)', () => {
    const p = parseazaTgz(xlsxDin([['1', '', 'PRU', 'MH', 'Test Fără Tronson', 'Str. A', 1, '', '', '', '']]), { ...OPT, tronsonPeUat: { HUS: 3 } })
    expect(p.parcele).toHaveLength(1)
    expect(p.parcele[0]).toMatchObject({ uat3: 'PRU', tronson: null, id_parcela: 'PRU-????' })
    expect(p.erori.filter(e => /Tronson/.test(e.motiv))).toEqual([])
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
      randuri.push([nrCrt, `HG ${x}`, uat, 'Mehedinți', `Test Persoană ${i}`, i % 7 === 0 ? '' : `Sat Fictiv ${i % 30}, Com. ${uat}, Str. Test nr. ${i}`, x * 1.5, 'arabil', `T${x % 40}`, `CF ${1000 + x}`, 'privat'])
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
function creeazaFakeSupabase({ esueazaLa = null, esueazaLaLot = null, esueazaCitireDupaInsert = null, esueazaMarcareEsuat = false, numereInitiale = {} } = {}) {
  const tabele = { red_parcele: [], red_detinatori: [], red_detinatori_contact: [], red_import_loturi: [] }
  const apeluri = []
  const numere = { ...numereInitiale }   // 'HUS' → ultimul rezervat
  const contorInsert = {}
  let nr = 0
  const uuid = () => `uuid-${++nr}`
  const stare = { esueazaLa, esueazaLaLot, esueazaCitireDupaInsert, esueazaMarcareEsuat }

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
      if (stare.esueazaCitireDupaInsert === this.tabel && (contorInsert[this.tabel] ?? 0) > 0) return { data: null, error: { message: `citire eșuată simulată la ${this.tabel}` } }
      let data = t.filter(r => this.filtre.every(f => f(r)))
      if (this.interval) data = data.slice(this.interval[0], this.interval[1] + 1)
      return { data: this.unRand ? data[0] ?? null : data, error: null }
    }
    then(ok, ko) { return Promise.resolve(this._exec()).then(ok, ko) }
  }
  const rpc = async (nume, args) => {
    apeluri.push({ op: 'rpc', nume, args })
    if (nume !== RPC_REZERVA_NUMERE) return { data: null, error: { message: `rpc necunoscut ${nume}` } }
    const k = `${args.p_uat3}`
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
    parcele.push({ cheie, cheie_sursa, ambigua: false, nr_crt: i, uat_id: 'uuid-hus', uat3: 'HUS', id_parcela: 'HUS-????', nr_provizoriu: i, tronson: 3, poz_hg: `HG ${i}`, suprafata_temporara_mp: i, categoria_folosinta: 'arabil', tarla: `T${i % 40}`, nr_cadastral: `CF ${1000 + i}`, observatii: null, rand: 3 + i, nr_detinatori: 1 })
    const cheieDet = `${cheie}|TEST PERSOANA ${i}`
    detinatori.push({ cheie: cheieDet, cheie_parcela: cheie, id_parcela: 'HUS-????', nr_crt: String(i), nume: `Test Persoana ${i}`, nume_normalizat: `TEST PERSOANA ${i}`, calitate: 'proprietar', cota: null, sursa_date: 'TGZ', versiune_lista_tgz: 'v1', rand: 3 + i })
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
    expect(sb.tabele.red_parcele.filter(p => p.uat_id === 'uuid-hus').map(p => p.id_parcela)).toEqual(['HUS-0001', 'HUS-0002', 'HUS-0003', 'HUS-0004', 'HUS-0005', 'HUS-0006', 'HUS-0007'])
    expect(sb.tabele.red_parcele.find(p => p.uat_id === 'uuid-pru').id_parcela).toBe('PRU-0001')
    expect(sb.apeluri.filter(a => a.op === 'rpc').map(a => a.args)).toEqual([{ p_uat3: 'HUS', p_n: 7 }, { p_uat3: 'PRU', p_n: 1 }])
    expect(sb.tabele.red_parcele[0]).toMatchObject({ proiect_id: 'proiect-1', uat_id: 'uuid-hus', tronson: 3, id_parcela: 'HUS-0001', cheie_sursa: 'HUS|HG 1|CF 1001|T12' })
    expect(sb.tabele.red_parcele.every(p => !p.id_parcela.includes('?'))).toBe(true)

    // legături: coproprietarii pointează la uuid-ul parcelei HUS-0003; contactul la uuid-ul deținătorului
    const p7 = sb.tabele.red_parcele.find(p => p.id_parcela === 'HUS-0003')
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
      'insert:red_parcele', 'update:red_import_loturi', 'select:red_parcele',          // contorul imediat după INSERT, apoi recitirea id-urilor (P2-1)
      'insert:red_detinatori', 'update:red_import_loturi', 'select:red_detinatori',
      'insert:red_detinatori_contact', 'update:red_import_loturi',
      'select:red_parcele',            // r5 (C-P2-04): reconcilierea recitește din BD parcelele scrise / refolosite
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
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toEqual([{ op: 'rpc', nume: RPC_REZERVA_NUMERE, args: { p_uat3: 'HUS', p_n: 450 } }])
    expect(sb.tabele.red_parcele[449].id_parcela).toBe('HUS-0450')
    expect(LOT).toBe(200); expect(LOT_CITIRE).toBe(100)
    expect(selecturi(sb).every(a => a.in <= 100 && a.pagini >= 1)).toBe(true)
    // existență: 450 chei → 5 selecturi; citiri id după insert: 200→2, 200→2, 50→1
    // r5: + reconcilierea pe cele 450 de chei (100/100/100/100/50)
    expect(selecturi(sb).filter(a => a.tabel === 'red_parcele').map(a => a.in)).toEqual([100, 100, 100, 100, 50, 100, 100, 100, 100, 50, 100, 100, 100, 100, 50])
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
    expect(r2.existente.sort()).toEqual(['HUS-0001', 'HUS-0002', 'HUS-0003', 'HUS-0004', 'HUS-0005', 'HUS-0006', 'HUS-0007', 'PRU-0001'])
    expect(sb.tabele.red_parcele).toHaveLength(8)
    expect(sb.tabele.red_detinatori).toHaveLength(9)
    expect(sb.tabele.red_detinatori_contact).toHaveLength(9)
    expect(sb.tabele.red_import_loturi).toHaveLength(2)
    expect(sb.tabele.red_import_loturi[1]).toMatchObject({ stare: 'finalizat', parcele_noi: 0, detinatori_noi: 0, versiune_lista_tgz: 'v2', diferente: expect.objectContaining({ contacte_noi: 0 }) })
    expect(sb.numere['HUS']).toBe(7)   // niciun număr rezervat în plus
    expect(sb.apeluri.filter(a => a.op === 'rpc')).toHaveLength(2)
  })

  it('P1-1 parcelă existentă + deținător nou pe ea: parcela se refolosește, deținătorul și contactul se adaugă', async () => {
    const sb = creeazaFakeSupabase()
    await scrieImport(sb, parseazaTgz(xlsxDin(RANDURI.slice(0, 2)), OPT), { proiectId: 'proiect-1', versiune: 'v1' })
    const randuriV2 = [...RANDURI.slice(0, 2), ['1/2', 'HG 1', 'Husnicioara', 'Mehedinți', 'Test Mostenitor Nou', 'Str. Nouă 1', '120,5', 'arabil', 'T12', 'CF 1001', 'privat']]
    const r2 = await scrieImport(sb, parseazaTgz(xlsxDin(randuriV2), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 2, detinatoriNoi: 1, detinatoriExistenti: 2, contacteNoi: 1 })
    const p1 = sb.tabele.red_parcele.find(p => p.id_parcela === 'HUS-0001')
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
    expect(r.ambigue).toEqual([{ rand: 4, nr_crt: '1', nume: 'Test Ambiguu A', uat: 'HUS', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU }, { rand: 5, nr_crt: '2', nume: 'Test Ambiguu B', uat: 'HUS', cheie_sursa: 'HUS|HG 1|CF 1|T1', motiv: MOTIV_AMBIGUU }])
    expect(r.fara_cheie).toEqual([{ rand: 6, nr_crt: '3', nume: 'Test Fără Cheie', uat: 'HUS' }])
    expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['HUS-0001'])
    expect(sb.tabele.red_detinatori.map(d => d.nume)).toEqual(['Test Bun'])
    expect(sb.apeluri.filter(a => a.op === 'rpc')[0].args.p_n).toBe(1)
    expect(sb.tabele.red_import_loturi[0].diferente).toMatchObject({ fara_cheie: r.fara_cheie, ambigue: r.ambigue })
    expect(sb.tabele.red_import_loturi[0].diferente.erori.filter(e => e.motiv === MOTIV_AMBIGUU)).toHaveLength(0)   // pct. 1: o singură dată (în ambigue)
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
    expect(sel.filter(a => a.tabel === 'red_parcele').map(a => [a.in, a.de_la])).toEqual([...pagini, ...pagini])   // r5: existență + reconcilierea cu BD
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

  it('P2-1 (r6): contorul crește imediat după INSERT — insert OK + recitirea id-urilor eșuată ⇒ lot esuat cu parcele_noi = N', async () => {
    const sb = creeazaFakeSupabase({ esueazaCitireDupaInsert: 'red_parcele' })
    await expect(scrieImport(sb, previewMare(7), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/citire id parcele: citire eșuată simulată/)
    expect(sb.tabele.red_parcele).toHaveLength(7)
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 7, detinatori_noi: 0, eroare: expect.stringMatching(/citire id parcele/) })
    expect(updateuriLot(sb)).toEqual([{ parcele_noi: 7 }, expect.objectContaining({ stare: 'esuat', parcele_noi: 7 })])
    // la fel pentru deținători: inserați, recitirea pică ⇒ detinatori_noi = N
    const sb2 = creeazaFakeSupabase({ esueazaCitireDupaInsert: 'red_detinatori' })
    await expect(scrieImport(sb2, previewMare(5), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/citire id deținători/)
    expect(sb2.tabele.red_detinatori).toHaveLength(5)
    expect(sb2.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 5, detinatori_noi: 5, diferente: expect.objectContaining({ contacte_noi: 0 }) })
    // reluarea completează ce lipsește (contactele) fără dubluri
    sb2.stare.esueazaCitireDupaInsert = null
    const r = await scrieImport(sb2, previewMare(5), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 0, parceleRefolosite: 5, detinatoriNoi: 0, detinatoriExistenti: 5, contacteNoi: 5 })
    expect(sb2.tabele.red_detinatori).toHaveLength(5); expect(sb2.tabele.red_detinatori_contact).toHaveLength(5)
  })

  it('P2-8: dacă rezervarea ar depăși 9999 pe un UAT → oprire ÎNAINTE de orice INSERT, lot esuat cu 0 scrieri', async () => {
    const sb = creeazaFakeSupabase({ numereInitiale: { 'HUS': 9990 } })
    await expect(scrieImport(sb, previewMare(15), { proiectId: 'proiect-1', versiune: 'v1' })).rejects.toThrow(/UAT HUS ar depăși 9999 \(15 parcele noi de la 9991 → 10005\); nimic nu a fost scris/)
    expect(sb.tabele.red_parcele).toHaveLength(0); expect(sb.tabele.red_detinatori).toHaveLength(0); expect(sb.tabele.red_detinatori_contact).toHaveLength(0)
    expect(sb.apeluri.filter(a => a.op === 'insert').map(a => a.tabel)).toEqual(['red_import_loturi'])
    expect(sb.tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', parcele_noi: 0, detinatori_noi: 0, eroare: expect.stringMatching(/9999/) })
    // exact 9999 e în regulă
    const ok = creeazaFakeSupabase({ numereInitiale: { 'HUS': 9990 } })
    const r = await scrieImport(ok, previewMare(9), { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.parceleNoi).toBe(9)
    expect(ok.tabele.red_parcele[8].id_parcela).toBe('HUS-9999')
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
    expect(sb.numere['HUS']).toBe(3)
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
    expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['HUS-0001', 'HUS-0002'])

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

// ───────── 04.11.2026 r2: cheia de identitate NEschimbată; cadastru doar-„#” fără HG = fără cheie; Nr.Crt. „x.y/z”; rânduri numărate o dată ─────────
// Date FICTIVE; reproduc doar FORMA valorilor din LOT1 („##”, „123##”, „#123#”, „166.1/1”), nu valori reale.
const randF = (nr, hg, nume, tarla, cad) => [nr, hg, 'Husnicioara', 'Mehedinți', nume, 'Str. Fictivă 1', 10, 'arabil', tarla, cad, 'privat']

describe('04.11.2026 r2 — cheieSursa identică cu main pentru orice rând cu identitate', () => {
  it('formatele LOT1 cu identitate: cheia e EXACT cea de dinainte (așteptări scrise de mână după regula din main)', () => {
    const cazuri = [
      [['HUS', 'HG 1', '123##', 'T1#'], 'HUS|HG 1|123##|T1#'],
      [['HUS', 'HG 1', '#123#', 'T1#'], 'HUS|HG 1|#123#|T1#'],      // subcâmpul parcelă/topo ≠ subcâmpul cadastral: identități diferite
      [['HUS', '', '123##', ''], 'HUS||123##|'],
      [['HUS', '', '#123#', 'T'], 'HUS||#123#|T'],
      [['HUS', 'HG 2', '##', 'T2#'], 'HUS|HG 2|##|T2#'],            // cu HG, „##” rămâne în cheie ca înainte
      [['HUS', 'HG 3', '#', '#'], 'HUS|HG 3|#|#'],
      [['HUS', '', '50029#30#', '12#'], 'HUS||50029#30#|12#'],
      [['HUS', '', '##UA 62A', ''], 'HUS||##UA 62A|'],
      [['hus', 'hg 4', 'cf  1001', 't12'], 'HUS|HG 4|CF 1001|T12'],
    ]
    for (const [arg, asteptat] of cazuri) expect(cheieSursa(...arg), arg.join(',')).toBe(asteptat)
    expect(cheieSursa('HUS', 'HG 1', '123##', 'T1#')).not.toBe(cheieSursa('HUS', 'HG 1', '#123#', 'T1#'))
  })
  it('singura schimbare: fără HG și cu cadastru gol (doar „#” / spații) → fără cheie', () => {
    for (const cad of ['##', '#', ' # # ', '', null]) expect(cheieSursa('HUS', '', cad, 'T5#'), String(cad)).toBeNull()
    expect(cadastruGol('##')).toBe(true); expect(cadastruGol(' # ')).toBe(true); expect(cadastruGol('')).toBe(true)
    expect(cadastruGol('#1#')).toBe(false); expect(cadastruGol('##UA')).toBe(false)
  })
  it('r3 (J-P2-1 / C-P2-01): alte semne fără litere/cifre („-”, „---”, „?”, „...”, „/”, „*”) rămân identitate EXACT ca în main', () => {
    // așteptările = regula din main (normalizeazaNume strânge punctuația repetată: „---” → „-”), scrise de mână
    for (const [cad, inCheie] of [['-', '-'], ['---', '-'], ['?', '?'], ['???', '?'], ['...', '.'], ['/', '/'], ['*', '*'], ['#-#', '#-#'], ['#?#', '#?#']]) {
      expect(cadastruGol(cad), cad).toBe(false)
      expect(cheieSursa('HUS', '', cad, 'T1'), cad).toBe(`HUS||${inCheie}|T1`)
    }
  })
  it('cadastruSuspect: marcaj pe subcâmpuri umplutură (0, 000, 999…, fără cifre); numere reale și gol → nu', () => {
    for (const v of ['0', '000', '999', '9999', '#999#', '999##', 'DE', '##DE']) expect(cadastruSuspect(v), v).toBe(true)
    for (const v of ['123', '9990', '50029#30', '999#30', '99', '##', '', null]) expect(cadastruSuspect(v), String(v)).toBe(false)
  })
})

describe('04.11.2026 — parseazaNrCrt „x.y/z” (decizie Răzvan: 166.1 = parcelă separată de 166)', () => {
  it('pozitive', () => {
    expect(parseazaNrCrt('166.1/1')).toEqual({ x: 166, sub: 1, y: 1, grup: '166.1', punct_fara_slash: false })
    expect(parseazaNrCrt('198.2/1')).toEqual({ x: 198, sub: 2, y: 1, grup: '198.2', punct_fara_slash: false })
    expect(parseazaNrCrt('166.1')).toEqual({ x: 166, sub: 1, y: null, grup: '166.1', punct_fara_slash: true })
    expect(parseazaNrCrt('166.1 - 2')).toEqual({ x: 166, sub: 1, y: 2, grup: '166.1', punct_fara_slash: false })
    expect(parseazaNrCrt('7.2')).toEqual({ x: 7, sub: 2, y: null, grup: '7.2', punct_fara_slash: true })   // punctul NU mai e separator x/y
    expect(parseazaNrCrt('07/1')).toEqual({ x: 7, sub: null, y: 1, grup: '7', punct_fara_slash: false })   // compatibil cu regula veche
    expect(parseazaNrCrt('9007199254740991')).toMatchObject({ x: 9007199254740991 })   // MAX_SAFE_INTEGER încă e valid
  })
  it('negative (inclusiv precizie / overflow — Copilot r1 P2-04)', () => {
    for (const v of ['166.01/1', '166./1', '166.1.2', '.1/1', '0/1', '7/0', '166.0/1', '166.1/', '166.1//1', '166.1/1a', '166.1\n/1',
      '9007199254740993', '9007199254740993/1', '7/9007199254740993', '7.9007199254740993', '1'.repeat(400)]) expect(parseazaNrCrt(v), JSON.stringify(v).slice(0, 30)).toBeNull()
    expect(parseazaNrCrt(166.1)).toBeNull()   // număr Excel neîntreg: fără reparsare
    expect(parseazaNrCrt(2 ** 53)).toBeNull()
    expect(parseazaNrCrt(Infinity)).toBeNull()
  })
})

describe('04.11.2026 r2 — parseazaTgz pe formatele LOT1 (fictive)', () => {
  it('166/1, 166/2 și 166.1/1, 166.1/2 = două parcele separate; nr_crt „166.1”; cheile neschimbate', () => {
    const p = parseazaTgz(xlsxDin([randF('166/1', 'HG 1', 'Test A', 'T1#', '100##'), randF('166/2', 'HG 1', 'Test B', 'T1#', '100##'),
      randF('166.1/1', 'HG 2', 'Test C', 'T1#', '101##'), randF('166.1/2', 'HG 2', 'Test D', 'T1#', '101##')]), OPT)
    expect(p.erori).toEqual([])
    expect(p.parcele.map(x => [x.cheie, x.nr_crt, x.cheie_sursa, x.nr_cadastral, x.nr_detinatori, x.ambigua, x.grup_sub, x.observatii])).toEqual([
      ['HUS:166', 166, 'HUS|HG 1|100##|T1#', '100##', 2, false, null, 'Regim juridic: privat'],
      ['HUS:166.1', '166.1', 'HUS|HG 2|101##|T1#', '101##', 2, false, '166.1', 'Regim juridic: privat'],
    ])
  })
  it('„123##” și „#123#” pe Nr.Crt. diferite = două parcele distincte, neambigue (nu se contopesc)', () => {
    const p = parseazaTgz(xlsxDin([randF('1', 'HG 1', 'Test A', 'T1#', '123##'), randF('2', 'HG 1', 'Test B', 'T1#', '#123#')]), OPT)
    expect(p.parcele.map(x => [x.cheie_sursa, x.ambigua])).toEqual([['HUS|HG 1|123##|T1#', false], ['HUS|HG 1|#123#|T1#', false]])
  })
  it('„123##” și „#123#” sub ACELAȘI Nr.Crt. = contradicție (ca în main), nu echivalență', () => {
    const p = parseazaTgz(xlsxDin([randF('7/1', 'HG 1', 'Test A', 'T1#', '123##'), randF('7/2', 'HG 1', 'Test B', 'T1#', '#123#')]), OPT)
    expect(p.parcele[0]).toMatchObject({ ambigua: true, motiv_ambiguitate: MOTIV_CONTRADICTORIU })
  })
  it('fără HG + cadastru „##” / „#” = fără cheie, cu TOATE rândurile grupului (și dublura de nume — Jakarinos r1 P2-4)', async () => {
    const p = parseazaTgz(xlsxDin([randF('1/1', '', 'Test Gol', 'T5#', '##'), randF('1/2', '', 'TEST  GOL', 'T5#', '##'), randF('2', '', 'Test Diez', '#', '#'),
      randF('3', 'HG 3', 'Test Bun', 'T7#', '50029#30#')]), OPT)
    expect(p.parcele.map(x => [x.cheie, x.cheie_sursa])).toEqual([['HUS:1', null], ['HUS:2', null], ['HUS:3', 'HUS|HG 3|50029#30#|T7#']])
    expect(p.dubluri.map(d => d.rand)).toEqual([5])
    expect(p.fara_cheie.map(f => [f.rand, f.uat])).toEqual([[4, 'HUS'], [5, 'HUS'], [6, 'HUS']])
    expect(p.statistici).toMatchObject({ parcele_fara_cheie: 2, fara_cheie: 3, parcele_de_importat: 1, randuri_de_tratat: 3 })
    const sb = creeazaFakeSupabase()
    const r = await scrieImport(sb, p, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.fara_cheie.map(f => f.rand)).toEqual([4, 5, 6])
    expect(sb.tabele.red_import_loturi[0].diferente.fara_cheie.map(f => f.rand)).toEqual([4, 5, 6])
    expect(sb.tabele.red_parcele.map(x => x.cheie_sursa)).toEqual(['HUS|HG 3|50029#30#|T7#'])
  })
  it('cadastru suspect: marcat pe rândul care CONȚINE valoarea, cu starea reală a parcelei (Copilot r1 P2-03)', () => {
    const p = parseazaTgz(xlsxDin([
      randF('7/1', 'HG 7', 'Test A', 'T1#', ''), randF('7/2', 'HG 7', 'Test B', 'T1#', '999##'),   // suspectul e pe 7/2, nu pe primul rând
      randF('8', 'HG 8', 'Test C', 'T8#', '0##'), randF('9', 'HG 8', 'Test D', 'T8#', '0##'),         // coliziune 8 ↔ 9 ⇒ nu se importă
    ]), OPT)
    expect(p.cadastru_suspect.map(c => [c.rand, c.nr_crt, c.detaliu])).toEqual([
      [5, '7/2', `cadastru: „999##”; ${STARE_ELIGIBILA}`],
      [6, '8', 'cadastru: „0##”; parcela NU se importă (ambiguă)'], [7, '9', 'cadastru: „0##”; parcela NU se importă (ambiguă)'],
    ])
    expect(p.parcele[0]).toMatchObject({ cheie_sursa: 'HUS|HG 7|999##|T1#', ambigua: false })   // marcajul nu schimbă cheia
    const r = randuriDeTratat(p)
    expect(r.find(x => x.rand === 5)).toMatchObject({ categorie: 'cadastru suspect', informativ: true })
    expect(r.find(x => x.rand === 6)).toMatchObject({ categorie: 'ambiguă + cadastru suspect', informativ: false })
    expect(numarRanduriPuseDeoparte(r)).toBe(2)
  })
  it('pct. 1: fiecare rând pus deoparte apare O DATĂ; contorul = rânduri distincte (inclusiv Nr.Crt. invalid)', () => {
    const p = parseazaTgz(xlsxDin([
      randF('7/1', 'HG 1', 'Test A', 'T1', '100'), randF('7/2', 'HG 1', 'Test B', 'T1', '200'),   // contradicție în grupul 7
      randF('9', 'HG 9', 'Test D', 'T9', '900'), randF('10', 'HG 9', 'Test E', 'T9', '900'),       // coliziune 9 ↔ 10
      randF('abc', 'HG 11', 'Test F', 'T11', '1100'),                                             // Nr.Crt. invalid → eroare
    ]), OPT)
    expect(p.erori.map(e => e.rand)).toEqual([8])
    expect(p.ambigue.map(a => a.rand)).toEqual([4, 5, 6, 7])
    expect(p.statistici).toMatchObject({ ambigue: 4, erori: 1, randuri_de_tratat: 5 })
    expect(numarRanduriPuseDeoparte(randuriDeTratat(p))).toBe(5)
  })
})

describe('04.11.2026 r2 — randuriDeTratat pe un lot finalizat VECHI', () => {
  it('rândul raportat de două ori în erori (contradicție + coliziune) și o dată în ambigue = 1 rând, cu AMBELE diagnostice (Copilot r1 P2-02)', () => {
    const diferente = {   // forma din red_import_loturi.diferente, valori fictive
      erori: [
        { rand: 4, nr_crt: 7, nume: 'Test Ascuns', motiv: MOTIV_CONTRADICTORIU, cheie_sursa: 'HUS|HG 1|100|T1', detaliu: 'cadastru: „100” / „200”' },
        { rand: 4, nr_crt: 7, nume: 'Test Ascuns', motiv: MOTIV_AMBIGUU, cheie_sursa: 'HUS|HG 1|100|T1' },
        { rand: 9, motiv: 'Nr.Crt. invalid „166.1/1”', uat: 'Husnicioara', nume: 'Test Ascuns' },
      ],
      ambigue: [{ rand: 4, nr_crt: 7, nume: 'Test Ascuns', motiv: MOTIV_CONTRADICTORIU, detaliu: 'cadastru: „100” / „200”' }],
      fara_cheie: [],
    }
    const r = randuriDeTratat(diferente)
    expect(r.map(x => [x.rand, x.categorie])).toEqual([[4, 'ambiguă'], [9, 'eroare']])
    expect(r[0].motiv).toBe(`${MOTIV_CONTRADICTORIU} + ${MOTIV_AMBIGUU}`)
    expect(r[0].detaliu).toBe('cadastru: „100” / „200”')
    expect(numarRanduriPuseDeoparte(r)).toBe(2)
    expect(csvRanduriDeTratat(r)).not.toMatch(/Ascuns/)   // fără nume în CSV
  })
  it('intrările fără număr de rând nu se contopesc după motiv (Copilot r1 P3-01)', () => {
    const r = randuriDeTratat({ erori: [{ motiv: 'Fișierul nu are antet' }, { motiv: 'Fișierul nu are antet' }], ambigue: [], fara_cheie: [] })
    expect(r).toHaveLength(2)
    expect(numarRanduriPuseDeoparte(r)).toBe(2)
  })
  it('„cadastru suspect” singur = informativ, nu e pus deoparte', () => {
    const r = randuriDeTratat({ cadastru_suspect: [{ rand: 6, uat: 'HUS', nr_crt: '3', cheie_sursa: 'HUS|HG 3|999|', motiv: MOTIV_CADASTRU_SUSPECT, detaliu: 'cadastru: „999”; parcela se importă' }] })
    expect(r.map(x => [x.categorie, x.informativ])).toEqual([['cadastru suspect', true]])
    expect(numarRanduriPuseDeoparte(r)).toBe(0)
  })
})

describe('04.11.2026 r4 — reimport: chei neschimbate; grupul Nr.Crt. comparat EXACT cu red_parcele.nr_crt_grup (20261130h)', () => {
  const FISIER = [randF('1', 'HG 1', 'Test Unu', 'T1#', '123##'), randF('2', 'HG 2', 'Test Doi', 'T2#', '#123#'), randF('3', 'HG 3', 'Test Trei', 'T3#', '##'),
    randF('4', '', 'Test Fals', 'T4#', '##'), randF('5', '', 'Test Liniuta', 'T5#', '-')]
  it('parcelele cu identitate se potrivesc pe cheile din BD (aceeași formă ca în main) → 0 noi; doar rândul fără HG + „##” devine fără cheie', async () => {
    const sb = creeazaFakeSupabase()
    // BD „legacy”: cheile scrise de regula din main, INCLUSIV identitatea falsă „HUS||##|T4#” (ca la cele 9 parcele LOT1); nr_crt_grup NULL
    const vechi = parseazaTgz(xlsxDin(FISIER), OPT)
    vechi.parcele[3].cheie_sursa = 'HUS||##|T4#'
    await scrieImport(sb, vechi, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(sb.tabele.red_parcele.map(p => [p.cheie_sursa, p.nr_crt_grup])).toEqual([['HUS|HG 1|123##|T1#', null], ['HUS|HG 2|#123#|T2#', null], ['HUS|HG 3|##|T3#', null], ['HUS||##|T4#', null], ['HUS||-|T5#', null]])
    const r2 = await scrieImport(sb, parseazaTgz(xlsxDin(FISIER), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r2).toMatchObject({ parceleNoi: 0, parceleRefolosite: 4, detinatoriNoi: 0, contacteNoi: 0, nr_crt_incompatibil: [] })
    expect(r2.reconciliere).toMatchObject({ eligibile: 4, noi: 0, refolosite: 4, oprite: 0, ok: true, confirmate_bd: 4, randuri_fisier: { randuri: 5, in_parcele: 5, erori: 0, ok: true } })
    expect(r2.fara_cheie.map(f => f.rand)).toEqual([7])   // parcela „falsă” existentă: neatinsă, raportată de tratat; „-” rămâne identitate ca în main
    expect(sb.tabele.red_parcele).toHaveLength(5)
    expect(sb.tabele.red_detinatori).toHaveLength(5)
  })

  // Copilot r2/r3 P1 + Jakarinos r3 P1 (P3-01: matricea completă grup din fișier × grup din BD)
  const importa = async (sb, randuri, versiune) => scrieImport(sb, parseazaTgz(xlsxDin(randuri), { ...OPT, versiune }), { proiectId: 'proiect-1', versiune })
  const MATRICE = [
    // [grupul existent (prin Nr.Crt. importat), Nr.Crt. nou, se refolosește?]
    ['166/1', '166/2', true], ['166/1', '166', true], ['166/1', '166.1/1', false], ['166/1', '166.1-1', false], ['7/2', '7.2', false],
    ['166.1/1', '166.1/2', true], ['166.1/1', '166.1', true], ['166.1/1', '166/1', false], ['166.1/1', '166.2/1', false], ['166.1/1', '167.1/1', false],
  ]
  it.each(MATRICE)('BD %s → fișier %s: refolosire = %s', async (vechi, nou, refolosit) => {
    const sb = creeazaFakeSupabase()
    await importa(sb, [randF(vechi, 'HG 1', 'Test Vechi', 'T1#', '123##')], 'v1')
    const grupBd = sb.tabele.red_parcele[0].nr_crt_grup
    expect(grupBd).toBe(vechi.includes('.') ? vechi.split(/[\/-]/)[0] : null)
    const r = await importa(sb, [randF(nou, 'HG 1', 'Test Nou', 'T1#', '123##'), randF('8', 'HG 8', 'Test Opt', 'T8', 'CF 8')], 'v2')
    expect(r.reconciliere.ok).toBe(true)
    if (refolosit) {
      expect(r).toMatchObject({ parceleRefolosite: 1, parceleNoi: 1, nr_crt_incompatibil: [] })
      expect(sb.tabele.red_detinatori.map(d => d.nume)).toEqual(['Test Vechi', 'Test Nou', 'Test Opt'])
    } else {
      expect(r).toMatchObject({ parceleRefolosite: 0, parceleNoi: 1, detinatoriNoi: 1 })
      const grupFisier = nou.includes('.') ? nou.split(/[\/-]/)[0] : nou.split(/[\/-]/)[0]
      expect(r.nr_crt_incompatibil).toEqual([{ rand: 4, nr_crt: nou, uat: 'HUS', cheie_sursa: 'HUS|HG 1|123##|T1#', motiv: MOTIV_NRCRT_INCOMPATIBIL,
        detaliu: `parcela existentă HUS-0001 (${grupBd ? `grup ${grupBd}` : 'fără subnumăr'}) ≠ grupul din fișier ${grupFisier}` }])
      expect(sb.tabele.red_parcele.map(p => p.id_parcela)).toEqual(['HUS-0001', 'HUS-0002'])
      expect(sb.tabele.red_detinatori.map(d => d.nume)).toEqual(['Test Vechi', 'Test Opt'])   // „Test Nou” NU s-a lipit pe parcela existentă
      const lot = sb.tabele.red_import_loturi.at(-1)
      expect(lot.diferente.nr_crt_incompatibil).toEqual(r.nr_crt_incompatibil)
      const tratat = randuriDeTratat(lot.diferente)
      expect(tratat.map(x => [x.rand, x.categorie])).toEqual([[4, 'Nr.Crt. incompatibil']])
      expect(numarRanduriPuseDeoparte(tratat)).toBe(1)
    }
  })
  it('INSERT: grupul cu subnumăr ajunge în nr_crt_grup; observatii nu mai poartă niciun marcaj', async () => {
    const sb = creeazaFakeSupabase()
    await importa(sb, [randF('166.1/1', 'HG 1', 'Test A', 'T1#', '123##'), randF('7.2', 'HG 2', 'Test B', 'T2', 'CF 2'), randF('9', 'HG 9', 'Test C', 'T9', 'CF 9')], 'v1')
    expect(sb.tabele.red_parcele.map(p => [p.id_parcela, p.nr_crt_grup, p.observatii])).toEqual([
      ['HUS-0001', '166.1', 'Regim juridic: privat'], ['HUS-0002', '7.2', 'Regim juridic: privat'], ['HUS-0003', null, 'Regim juridic: privat'],
    ])
  })
  it('Jakarinos r3 P1-02 / Copilot r3 P1-02: text liber care imită vechiul marcaj („Regim juridic” cu „Nr.Crt. TGZ: 166.2”) nu mai influențează potrivirea', async () => {
    const sb = creeazaFakeSupabase()
    const rand166 = [...randF('166.1/1', 'HG 1', 'Test A', 'T1#', '123##')]; rand166[10] = 'privat; Nr.Crt. TGZ: 166.2'
    await importa(sb, [rand166], 'v1')
    expect(sb.tabele.red_parcele[0].nr_crt_grup).toBe('166.1')
    const r = await importa(sb, [randF('166.2/1', 'HG 1', 'Test Fals', 'T1#', '123##')], 'v2')
    expect(r).toMatchObject({ parceleRefolosite: 0, detinatoriNoi: 0 })
    expect(r.nr_crt_incompatibil).toHaveLength(1)
  })
  it('Anexa 7 (fără Nr.Crt.) peste o parcelă TGZ „166.1”, pe aceeași cheie → refolosită + raportată (Copilot r3 P2-01); altă cheie → nouă, grup NULL', async () => {
    const sb = creeazaFakeSupabase()
    await importa(sb, [randF('166.1/1', 'HG 1', 'Test A', 'T1#', '123##')], 'v1')
    // forma preview-ului Anexa 7: parseazaAnexa7 pune nr_crt: null pe parcele (sursa nu are Nr.Crt.)
    const pv = parseazaTgz(xlsxDin([randF('1', 'HG 1', 'Test Anexa', 'T1#', '123##'), randF('2', 'HG 5', 'Test Anexa Nou', 'T5', 'CF 5')]), { ...OPT, versiune: 'a7' })
    const anexa = { ...pv, parcele: pv.parcele.map(p => ({ ...p, nr_crt: null, grup_sub: null })) }
    const r = await scrieImport(sb, anexa, { proiectId: 'proiect-1', versiune: 'a7', sursa: 'ANEXA7' })
    expect(r).toMatchObject({ parceleRefolosite: 1, parceleNoi: 1, nr_crt_incompatibil: [] })
    expect(r.refolosite_fara_nr_crt).toEqual([{ id_parcela: 'HUS-0001', nr_crt_grup: '166.1', cheie_sursa: 'HUS|HG 1|123##|T1#', rand: 4 }])
    expect(sb.tabele.red_parcele.map(p => [p.id_parcela, p.nr_crt_grup])).toEqual([['HUS-0001', '166.1'], ['HUS-0002', null]])
    expect(sb.tabele.red_import_loturi.at(-1).diferente.refolosite_fara_nr_crt).toEqual(r.refolosite_fara_nr_crt)
  })

  // Jakarinos r3 P2-01 / Copilot r3 P2-02: starea „cadastru suspect” vine din ce s-a CONFIRMAT, nu din plan
  const SUSPECT = [randF('7.2', 'HG 1', 'Test Nou', 'T1#', '999##'), randF('9', 'HG 9', 'Test Noua', 'T9', '0'), randF('10', 'HG 10', 'Test Zece', 'T10', '000')]
  const pregatit = async () => {
    const sb = creeazaFakeSupabase()
    await importa(sb, [randF('7/2', 'HG 1', 'Test Vechi', 'T1#', '999##'), randF('9', 'HG 9', 'Test Noua', 'T9', '0')], 'v1')
    return sb
  }
  it('succes: oprit / existentă refolosită / nouă inserată', async () => {
    const sb = await pregatit()
    const pv = parseazaTgz(xlsxDin(SUSPECT), { ...OPT, versiune: 'v2' })
    expect(pv.cadastru_suspect.map(c => c.detaliu)).toEqual([`cadastru: „999##”; ${STARE_ELIGIBILA}`, `cadastru: „0”; ${STARE_ELIGIBILA}`, `cadastru: „000”; ${STARE_ELIGIBILA}`])
    const r = await scrieImport(sb, pv, { proiectId: 'proiect-1', versiune: 'v2' })
    expect(r.diferente.cadastru_suspect.map(c => [c.rand, c.detaliu])).toEqual([
      [4, 'cadastru: „999##”; parcela NU s-a importat (Nr.Crt. incompatibil)'], [5, 'cadastru: „0”; parcela existentă refolosită'], [6, 'cadastru: „000”; parcela nouă inserată'],
    ])
    expect(sb.tabele.red_import_loturi.at(-1).diferente.cadastru_suspect).toEqual(r.diferente.cadastru_suspect)
    const tratat = randuriDeTratat(r.diferente)
    expect(tratat.find(x => x.rand === 4)).toMatchObject({ categorie: 'Nr.Crt. incompatibil + cadastru suspect', informativ: false })
  })
  it('eșec la INSERT-ul parcelelor: 0 parcele scrise, lot esuat, starea parcelei noi = necunoscut (nu „inserată”)', async () => {
    const sb = await pregatit()
    sb.stare.esueazaLa = 'red_parcele'
    await expect(scrieImport(sb, parseazaTgz(xlsxDin(SUSPECT), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })).rejects.toThrow(/eșec simulat/)
    const lot = sb.tabele.red_import_loturi.at(-1)
    expect(lot).toMatchObject({ stare: 'esuat', parcele_noi: 0 })
    expect(lot.diferente.cadastru_suspect.map(c => [c.rand, c.stare])).toEqual([
      [4, 'parcela NU s-a importat (Nr.Crt. incompatibil)'], [5, 'parcela existentă (refolosire neîncheiată — import oprit; deținătorii pot lipsi)'], [6, STARE_NECONFIRMATA],
    ])
    expect(JSON.stringify(lot.diferente)).not.toMatch(/inserată|refolosită"/)
  })
  it('eșec la deținători (după INSERT-ul parcelelor): parcela nouă = inserată, cea existentă = refolosire neîncheiată', async () => {
    const sb = await pregatit()
    sb.stare.esueazaLa = 'red_detinatori'
    await expect(scrieImport(sb, parseazaTgz(xlsxDin(SUSPECT), { ...OPT, versiune: 'v2' }), { proiectId: 'proiect-1', versiune: 'v2' })).rejects.toThrow(/eșec simulat/)
    const lot = sb.tabele.red_import_loturi.at(-1)
    expect(lot).toMatchObject({ stare: 'esuat', parcele_noi: 1 })
    expect(lot.diferente.cadastru_suspect.map(c => c.stare)).toEqual(['parcela NU s-a importat (Nr.Crt. incompatibil)', 'parcela existentă (refolosire neîncheiată — import oprit; deținătorii pot lipsi)', 'parcela nouă inserată'])
  })
})

// ───────── r5 (Jakarinos r4 P2 / Copilot r4 P2-01): regula grupului — O SINGURĂ definiție, paritate JS ↔ SQL ─────────
const MIGRARE_30H = readFileSync(new URL('../../../supabase/migrations/20261130h_redari_parcele_nr_crt_grup.sql', import.meta.url), 'utf8')
const DRY_30H = readFileSync(new URL('../../../supabase/tests/20261130h_redari_parcele_nr_crt_grup_dryrun.sql', import.meta.url), 'utf8')
const listaDry = marcaj => { const l = DRY_30H.split('\n').find(x => x.includes(`-- ${marcaj}`)); return [...l.slice(0, l.indexOf(`-- ${marcaj}`)).matchAll(/'([^']*)'/g)].map(m => m[1]) }
describe('r5 — paritatea regulii nr_crt_grup între parser și CHECK-ul migrării 20261130h', () => {
  it('regex-ul și lungimea din CHECK sunt EXACT cele din parser', () => {
    const m = MIGRARE_30H.match(/CONSTRAINT red_parcele_nr_crt_grup_forma CHECK \(nr_crt_grup IS NULL OR \(length\(nr_crt_grup\) <= (\d+) AND nr_crt_grup ~ '([^']+)'\)\)/)
    expect(m).not.toBeNull()
    expect(m[2]).toBe(RE_NR_CRT_GRUP_SQL)
    expect(Number(m[1])).toBe(NR_CRT_GRUP_MAX)
  })
  it('tabelul de cazuri din DRY (rulat în PostgreSQL) dă același rezultat în JS', () => {
    const invalide = listaDry('PARITATE_INVALIDE'); const valide = listaDry('PARITATE_VALIDE')
    expect(invalide.length).toBeGreaterThan(10); expect(valide.length).toBeGreaterThan(3)
    for (const v of invalide) expect(grupNrCrtValid(v), JSON.stringify(v)).toBe(false)
    for (const v of valide) expect(grupNrCrtValid(v), v).toBe(true)
  })
  it('parserul respinge (eroare pe rând) grupurile peste limita BD; fără subnumăr limita nu se aplică', () => {
    expect(parseazaNrCrt('999999999.999999999/1')).toMatchObject({ grup: '999999999.999999999' })
    for (const v of ['1000000000.1/1', '1.1000000000/1', '1000000000.1', '1.1000000000']) expect(parseazaNrCrt(v), v).toBeNull()
    expect(parseazaNrCrt('1000000000/1')).toMatchObject({ x: 1000000000, sub: null, grup: '1000000000' })
    const p = parseazaTgz(xlsxDin([randF('1000000000.1/1', 'HG 1', 'Test A', 'T1', 'CF 1'), randF('2', 'HG 2', 'Test B', 'T2', 'CF 2')]), OPT)
    expect(p.erori.map(e => [e.rand, e.motiv])).toEqual([[4, 'Nr.Crt. invalid „1000000000.1/1”']])
    expect(p.statistici.reconciliere_randuri).toEqual({ randuri: 2, in_parcele: 1, erori: 1, ok: true })
  })
  it('scrieImport: un grup invalid ajuns totuși în preview (modificat) e oprit „de tratat”, fără încercare de INSERT', async () => {
    const sb = creeazaFakeSupabase()
    const pv = parseazaTgz(xlsxDin([randF('166.1/1', 'HG 1', 'Test A', 'T1', 'CF 1'), randF('2', 'HG 2', 'Test B', 'T2', 'CF 2')]), OPT)
    pv.parcele[0].grup_sub = '1000000000.1'
    const r = await scrieImport(sb, pv, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1 })
    expect(r.nr_crt_incompatibil.map(x => [x.rand, x.detaliu])).toEqual([[4, 'grup Nr.Crt. invalid „1000000000.1” (max 9 + 9 cifre)']])
    expect(sb.tabele.red_parcele.map(x => x.nr_crt_grup)).toEqual([null])
  })
})

describe('r5 — sursa Anexa 7 explicită, preview legat de proiect, reconcilierea cu BD', () => {
  const importa = async (sb, randuri, versiune) => scrieImport(sb, parseazaTgz(xlsxDin(randuri), { ...OPT, versiune }), { proiectId: 'proiect-1', versiune })
  it('Copilot r4 P2-02: un preview TGZ cu nr_crt null NU primește excepția Anexa 7 — oprit față de parcela „166.1”', async () => {
    const sb = creeazaFakeSupabase()
    await importa(sb, [randF('166.1/1', 'HG 1', 'Test A', 'T1#', '123##')], 'v1')
    const pv = parseazaTgz(xlsxDin([randF('1', 'HG 1', 'Test Fals', 'T1#', '123##')]), { ...OPT, versiune: 'v2' })
    const modificat = { ...pv, parcele: pv.parcele.map(p => ({ ...p, nr_crt: null, grup_sub: null })) }
    const r = await scrieImport(sb, modificat, { proiectId: 'proiect-1', versiune: 'v2', sursa: 'TGZ' })
    expect(r).toMatchObject({ parceleRefolosite: 0, detinatoriNoi: 0, refolosite_fara_nr_crt: [] })
    expect(r.nr_crt_incompatibil).toHaveLength(1)
  })
  it('Copilot r4 P1-03: previzualizarea calculată pentru alt proiect e refuzată înainte de orice scriere', async () => {
    const sb = creeazaFakeSupabase()
    const pv = parseazaTgz(xlsxDin([randF('1', 'HG 1', 'Test A', 'T1', 'CF 1')]), OPT)
    pv.proiect_id_previzualizare = 'proiect-A'
    await expect(scrieImport(sb, pv, { proiectId: 'proiect-B', versiune: 'v1' })).rejects.toThrow(/alt proiect/)
    expect(sb.apeluri).toEqual([])
    const r = await scrieImport(sb, pv, { proiectId: 'proiect-A', versiune: 'v1' })
    expect(r).toMatchObject({ parceleNoi: 1 })
  })
  it('Copilot r4 P2-04: reconcilierea recitește BD — o parcelă care nu mai are grupul scris ⇒ lot esuat, nu „finalizat”', async () => {
    const sb = creeazaFakeSupabase()
    const pv = parseazaTgz(xlsxDin([randF('166.1/1', 'HG 1', 'Test A', 'T1', 'CF 1'), randF('2', 'HG 2', 'Test B', 'T2', 'CF 2')]), OPT)
    const onProgress = ({ etapa }) => { if (etapa === 'contacte') sb.tabele.red_parcele[0].nr_crt_grup = '166.9' }   // schimbare „din afară” între scriere și reconciliere
    await expect(scrieImport(sb, pv, { proiectId: 'proiect-1', versiune: 'v1', onProgress })).rejects.toThrow(/Reconcilierea cu BD: 1 parcele/)
    expect(sb.tabele.red_import_loturi.at(-1).stare).toBe('esuat')
    const sb2 = creeazaFakeSupabase()
    const r = await scrieImport(sb2, pv, { proiectId: 'proiect-1', versiune: 'v1' })
    expect(r.reconciliere).toMatchObject({ noi: 2, confirmate_bd: 2, ok: true })
    expect(sb2.tabele.red_import_loturi.at(-1).diferente.reconciliere).toMatchObject({ confirmate_bd: 2 })
  })
})
