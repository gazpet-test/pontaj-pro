import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaAnexa7 } from './importAnexa7.js'
import { cheieSursa } from './importTgz.js'

// Antet independent de parser: randul 5 al tipizatului real, fara randurile sale de exemplu.
const model = XLSX.read(readFileSync(new URL('../../docs/redari/referinta/Model_7_Anexa7_Tipizat_date_detinatori_TGZ.xlsx', import.meta.url)), { type: 'buffer' })
const sheet = model.Sheets[model.SheetNames[0]]
const antet = Array.from({ length: 30 }, (_, c) => sheet[XLSX.utils.encode_cell({ r: 4, c })]?.v ?? '')
const opt = { uats: [{ id: 'uat-test', nume: 'Husi', uat3: 'HUS', judet: 'Judet Test' }], tronsonPeUat: { HUS: 3 }, versiune: 'TEST 2026' }
function rand(modificari = {}) {
  // Indici din tipizatul Beneficiarului, NU din maparea parserului.
  const r = Array(30).fill('')
  Object.assign(r, { 0: 'Husi', 1: 'Sat Parcela Test', 2: 'T12', 3: 'CF100', 4: '10', 5: '12,5', 6: 'arabil', 8: 'POPESCU TEST ION', 9: 'coproprietar', 10: '1/3' }, modificari)
  return r
}
function excel(randuri, { titluri = 4, header = antet } = {}) {
  const foi = XLSX.utils.book_new()
  const prefix = Array.from({ length: titluri }, (_, i) => [i === titluri - 1 ? 'PARCELA / DETINATOR / CONTACT / STARE / SURSA' : 'Titlu test'])
  XLSX.utils.book_append_sheet(foi, XLSX.utils.aoa_to_sheet([...prefix, header, ...randuri]), 'Anexa 7')
  return XLSX.write(foi, { type: 'array', bookType: 'xlsx' })
}

describe('parseazaAnexa7', () => {
  it('importa tipizatul real: coproprietari, mostenitor, neidentificat, lipsa cheie si erori', () => {
    const pv = parseazaAnexa7(excel([
      rand({ 7: 'km 5+100', 11: 'DA', 12: 'Str. Fictiva 1', 13: 'Sat Adresa Test', 14: 'Comuna Test', 16: '000000', 17: '0000 000 000', 18: 'test@example.invalid', 21: 'TEST MOSTENITOR', 22: 'primarie test', 23: 'TEST ARENDAS', 24: 'TEST MANDAT', 25: 'NU', 26: 'in verificare', 27: 'Nota test', 28: 'CF', 29: '02.11.2026' }),
      rand({ 0: 'HUS', 8: 'IONESCU TEST ANA', 9: 'CoProprietar', 12: 'Str. Inventata 2', 15: 'Alt Judet Test' }),
      rand({ 8: 'GEORGESCU TEST DAN', 9: 'mostenitor legal', 20: 'DA' }),
      rand({ 3: 'CF200', 4: '20', 8: 'DETINATOR TEST NECUNOSCUT', 9: 'proprietar', 19: 'DA', 12: 'Str. Fictiva 3' }),
      rand({ 3: '', 4: '', 8: 'TEST FARA CHEIE', 9: 'utilizator', 17: '0000 000 000' }),
      rand({ 0: 'UAT INEXISTENT TEST', 8: 'TEST EROARE' }),
      [],
      rand({ 3: 'CF300', 4: '30', 8: 'TEST ARENDAS', 9: 'arendas temporar', 5: 7.25 }),
    ]), opt)
    expect(pv.antet.rand).toBe(4)
    expect(pv.antet.chei).toHaveLength(30)
    expect(pv.parcele).toHaveLength(4)
    expect(pv.detinatori).toHaveLength(6)
    expect(pv.contacte).toHaveLength(4)
    const p = pv.parcele[0]
    expect(p).toMatchObject({ cheie_sursa: 'HUS|10|CF100|T12', id_parcela: 'T3-HUS-????', sat: 'Sat Parcela Test', suprafata_temporara_mp: 12.5, nr_detinatori: 3, ambigua: false, tronson: 3 })
    expect(pv.detinatori.filter(d => d.cheie_parcela === p.cheie).map(d => d.calitate)).toEqual(['coproprietar', 'coproprietar', 'mostenitor'])
    expect(p.observatii).toContain('km 5+100')
    expect(pv.detinatori[2]).toMatchObject({ decedat: true, versiune_lista_tgz: 'TEST 2026', adresa_cunoscuta: false })
    const d = pv.detinatori[0]
    expect(d.sursa_date).toMatch(/^CF;/)
    for (const nota of ['TEST MOSTENITOR', 'primarie test', 'TEST ARENDAS', 'reprezentant: TEST MANDAT', 'Nota test', '02.11.2026', 'in verificare']) expect(d.sursa_date).toContain(nota)
    expect(pv.contacte[0]).toMatchObject({ cheie_detinator: d.cheie, adresa_strada: 'Str. Fictiva 1', adresa_sat: 'Sat Adresa Test', adresa_comuna: 'Comuna Test', adresa_judet: 'Judet Test', cod_postal: '000000', telefon: '0000 000 000', email: 'test@example.invalid', adresa_cunoscuta: true })
    expect(pv.contacte[1].adresa_judet).toBe('Alt Judet Test')
    expect(pv.detinatori[3]).toMatchObject({ calitate: 'neidentificat', adresa_cunoscuta: false })
    expect(pv.contacte[2].adresa_cunoscuta).toBe(false)
    expect(pv.contacte[3].adresa_cunoscuta).toBe(false) // Telefonul singur nu dovedeste adresa.
    expect(pv.fara_cheie).toHaveLength(1)
    expect(pv.parcele[2].cheie_sursa).toBeNull()
    expect(pv.detinatori[5].calitate).toBe('arendas')
    expect(pv.erori).toEqual([expect.objectContaining({ rand: 11, motiv: 'UAT necunoscut' })])
    expect(pv.statistici).toMatchObject({ randuri_total: 7, randuri_goale: 1, parcele: 4, detinatori: 6, contacte: 4, dubluri: 0, neidentificati: 1, fara_cheie: 1, ambigue: 0, erori: 1, parcele_fara_cheie: 1, parcele_ambigue: 0, parcele_de_importat: 3, detinatori_de_importat: 5, contacte_de_importat: 3 })
    expect(pv.statistici.pe_uat.HUS).toEqual({ parcele: 4, detinatori: 6, dubluri: 0, neidentificati: 1, fara_cheie: 1, ambigue: 0, erori: 0 })
  })

  it('gaseste antetul mutat si coloanele mutate, inclusiv cele doua Sat', () => {
    const order = [7, 0, 2, 3, 4, 5, 6, 1, ...Array.from({ length: 22 }, (_, i) => i + 8)]
    const data = rand({ 12: 'Str. Test', 13: 'Sat Contact' })
    const pv = parseazaAnexa7(excel([order.map(i => data[i])], { titluri: 7, header: order.map(i => antet[i]) }), opt)
    expect(pv.erori).toEqual([])
    expect(pv.antet.rand).toBe(7)
    expect(pv.parcele[0].sat).toBe('Sat Parcela Test')
    expect(pv.contacte[0].adresa_sat).toBe('Sat Contact')
  })

  it('pastreaza prima valoare contradictorie, raporteaza dublura si nu uneste randurile fara cheie', () => {
    const pv = parseazaAnexa7(excel([
      rand(), rand({ 1: 'Alt Sat', 5: 99, 6: 'pasune', 8: 'ALT TEST NUME' }),
      rand({ 8: '  popescu test ion  ', 27: 'nota duplicat' }),
      rand({ 3: '', 4: '' }), rand({ 3: '', 4: '' }),
    ]), opt)
    expect(pv.parcele).toHaveLength(3)
    expect(pv.parcele[0]).toMatchObject({ nr_detinatori: 2, suprafata_temporara_mp: 12.5, categoria_folosinta: 'arabil', sat: 'Sat Parcela Test' })
    for (const camp of ['sat', 'suprafata_temporara_mp', 'categoria_folosinta']) expect(pv.parcele[0].observatii).toContain(`${camp} contradictoriu`)
    expect(pv.ambigue).toEqual([])
    expect(pv.dubluri).toHaveLength(1)
    expect(pv.detinatori[0].sursa_date).toContain('nota duplicat')
    expect(pv.fara_cheie).toHaveLength(2)
    expect(pv.statistici).toMatchObject({ dubluri: 1, fara_cheie: 2, parcele_de_importat: 1, detinatori_de_importat: 2 })
  })

  it('atributele goale pe primul rand se completeaza din randul coproprietarului 2 (Gemini f3b r1 P2)', () => {
    const pv = parseazaAnexa7(excel([
      rand({ 1: '', 5: '', 6: '' }),
      rand({ 8: 'ALT TEST NUME', 1: 'Sat Completat', 5: '500', 6: 'arabil', 7: 'km 5+100' }),
      rand({ 8: 'AL TREILEA TEST', 1: 'Sat Completat', 5: '500,0', 7: 'km 5+100' }),
    ]), opt)
    expect(pv.parcele).toHaveLength(1)
    expect(pv.parcele[0]).toMatchObject({ sat: 'Sat Completat', suprafata_temporara_mp: 500, categoria_folosinta: 'arabil', nr_detinatori: 3 })
    expect(pv.parcele[0].observatii ?? '').not.toContain('contradictoriu')   // 500 vs 500,0 = aceeasi valoare numerica
    expect((pv.parcele[0].observatii.match(/Tronson \/ km din fisier/g) || []).length).toBe(1)   // nota o singura data
  })

  it('dublura aceluiasi detinator aduce contactul, cota si decedat lipsa (Gemini f3b r1 P2)', () => {
    const pv = parseazaAnexa7(excel([
      rand({ 10: '' }),
      rand({ 8: ' popescu test ion ', 10: '1/2', 20: 'DA', 12: 'Str. Dublura 1', 17: '0000 000 000' }),
    ]), opt)
    expect(pv.detinatori).toHaveLength(1)
    expect(pv.dubluri).toHaveLength(1)
    expect(pv.detinatori[0]).toMatchObject({ cota: '1/2', decedat: true, adresa_cunoscuta: true })
    expect(pv.contacte).toEqual([expect.objectContaining({ cheie_detinator: pv.detinatori[0].cheie, adresa_strada: 'Str. Dublura 1', telefon: '0000 000 000', adresa_cunoscuta: true })])
  })

  it('foloseste cheia TGZ completa: aceeasi HG cu cadastru diferit ramane parcela diferita', () => {
    const pv = parseazaAnexa7(excel([rand(), rand({ 3: 'CF101' })]), opt)
    expect(pv.parcele.map(p => p.cheie_sursa)).toEqual([cheieSursa('HUS', '10', 'CF100', 'T12'), cheieSursa('HUS', '10', 'CF101', 'T12')])
    expect(pv.parcele).toHaveLength(2)
  })

  it('calitate necunoscuta produce nota, NU nu activeaza DA, numere invalide sunt erori', () => {
    const pv = parseazaAnexa7(excel([
      rand({ 9: 'calitate necunoscuta', 19: 'NU', 20: 'NU', 5: '12.25' }),
      rand({ 8: '', 4: '11' }), rand({ 5: '12 mp' }), rand({ 5: -1 }),
      rand({ 3: 'CF102', 8: 'TEST AMBIGUU', 5: '1.234' }),
    ]), opt)
    expect(pv.detinatori[0]).toMatchObject({ calitate: 'proprietar', decedat: false, sursa_date: expect.stringContaining('necesita verificare') })
    expect(pv.parcele[0].suprafata_temporara_mp).toBe(12.25)
    expect(pv.erori.map(e => e.motiv)).toEqual(['Nume detinator gol', 'Suprafata invalida', 'Suprafata invalida'])
    expect(pv.detinatori[1].sursa_date).toContain('Suprafata ambigua')
    expect(pv.statistici.pe_uat.HUS.erori).toBe(3)
  })

  it('rand partial (fara UAT, dar cu date) = eroare, nu rand gol; UAT-uri cu nume normalizat identic = ambiguitate (Copilot f3b r1 P3)', () => {
    const pv = parseazaAnexa7(excel([rand({ 0: '', 8: '', 3: '', 4: '', 2: 'T13', 5: '100' })]), opt)
    expect(pv.statistici.randuri_goale).toBe(0)
    expect(pv.erori).toEqual([expect.objectContaining({ motiv: 'UAT lipsa pe un rand cu date' })])
    const optAmbiguu = { ...opt, uats: [...opt.uats, { id: 'uat-2', nume: 'HUȘI', uat3: 'HSI', judet: 'Judet Test' }], tronsonPeUat: { HUS: 3, HSI: 3 } }
    const pv2 = parseazaAnexa7(excel([rand(), rand({ 0: 'HSI', 8: 'TEST PE COD' })]), optAmbiguu)
    expect(pv2.erori.map(e => e.motiv)).toEqual([expect.stringContaining('UAT ambiguu')])
    expect(pv2.parcele).toHaveLength(1)   // randul cu codul HSI (neambiguu) trece
  })

  it('refuza antet incomplet sau ambiguu si tronson invalid', () => {
    const incomplet = [...antet]; incomplet[17] = 'Telefon necunoscut'
    expect(parseazaAnexa7(excel([rand()], { header: incomplet }), opt).erori[0].motiv).toContain('telefon')
    const ambiguu = [...antet]; ambiguu[2] = 'Sat'
    expect(parseazaAnexa7(excel([rand()], { header: ambiguu }), opt).erori[0].motiv).toContain('sat')
    const pv = parseazaAnexa7(excel([rand()]), { ...opt, tronsonPeUat: {} })
    expect(pv.parcele).toEqual([])
    expect(pv.erori[0].motiv).toContain('Tronson')
    expect(parseazaAnexa7(excel([], { header: ['Antet gresit'] }), opt).erori[0].motiv).toContain('Nu gasesc antetul')
  })

  it('golul nu devine zero si DA trebuie sa fie token complet', () => {
    const pv = parseazaAnexa7(excel([rand({ 5: '   ', 19: 'DA?', 20: 'D A', 12: 'Str. Test' })]), opt)
    expect(pv.erori).toEqual([])
    expect(pv.parcele[0].suprafata_temporara_mp).toBeNull()
    expect(pv.detinatori[0]).toMatchObject({ calitate: 'coproprietar', decedat: false, adresa_cunoscuta: true })
    expect(pv.detinatori[0].sursa_date).toContain('DA?')
  })

  it('mentine paritatea calitatilor cu UI fara a importa React', () => {
    const comune = readFileSync(new URL('./ui/comune.jsx', import.meta.url), 'utf8')
    const declaratie = comune.match(/export const CALITATI = (\[[^\]]+\])/)[1]
    const calitati = [...declaratie.matchAll(/'([^']+)'/g)].map(m => m[1])
    expect(calitati).toEqual(['proprietar', 'coproprietar', 'mostenitor', 'arendas', 'utilizator', 'neidentificat'])
    const pv = parseazaAnexa7(excel(calitati.map((c, i) => rand({ 8: `TEST CALITATE ${i}`, 9: c }))), opt)
    expect(pv.detinatori.map(d => d.calitate)).toEqual(calitati)
  })
})
