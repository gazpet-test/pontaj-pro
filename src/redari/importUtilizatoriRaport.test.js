// Redări PR4b: raportul importului de utilizatori — totaluri, categorii, starea după scriere și CSV-ul. Date fictive, fără PII.
// Cifrele așteptate sunt numărate de mână din fișierul sintetic de mai jos (nu din codul testat).
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaUtilizatori, planUtilizatori, COL } from './importUtilizatori.js'
import { totaluriImport, totaluriPeUat, randuriRaport, stareDupaScriere, csvRaportUtilizatori, MOTIV_NOU, MOTIV_NOU_HG } from './importUtilizatoriRaport.js'

const UATS = [{ id: 'u1', nume: 'Husnicioara', uat3: 'HUS' }, { id: 'u2', nume: 'Bâlvănești', uat3: 'BAL' }]
const rand = ({ uat = '02Husnicioara', hg = '', tarla = '', cad = '', nume = '', adresa = '', tel = '' }) => {
  const r = Array(27).fill('')
  r[COL.uat] = uat; r[COL.poz_hg] = hg; r[COL.tarla] = tarla; r[COL.nr_cadastral] = cad; r[COL.nume] = nume; r[COL.adresa] = adresa; r[COL.telefon] = tel
  return r
}
const fisier = (date) => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([Array(27).fill('A'), Array(27).fill('B'), Array(27).fill('C'), ...date]), 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
const ADR = 'Jud. Mehedinti, Com. Husnicioara, Sat Fictiv'
// rândurile Excel: 4 A nou (cheie) · 5 B același om pe altă parcelă · 6 C potrivit după HG · 7 D deja proprietar · 8 Armeniș (în afara)
// · 9 parcelă negăsită · 10 fără cheie · 11 dublură a lui 4 · 12 nume care începe cu „=” · 13 fără utilizator · 14/15 același om, adrese diferite
const DATE = [
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),
  rand({ uat: '06Bâlvănești', hg: '7', cad: '700', nume: 'IONESCU ANA (fictiv)', adresa: 'Jud. Mehedinti, Com. Bâlvănești, Sat Fictiv' }),
  rand({ hg: '20', cad: 'ALT', nume: 'ȘTEFĂNESCU ȚICU (fictiv)', adresa: ADR, tel: '0711 111 111' }),
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'POPESCU ION (fictiv)', adresa: ADR }),
  rand({ uat: '18Armeniș', hg: '1', cad: '1', nume: 'ALTCINEVA (fictiv)' }),
  rand({ hg: '99', cad: '999', nume: 'NEGASIT (fictiv)', adresa: ADR }),
  rand({ uat: '06Bâlvănești', hg: '#', cad: '##', nume: 'FARA CHEIE (fictiv)' }),
  rand({ hg: '10', tarla: '5', cad: '100', nume: 'IONESCU ANA (fictiv)', adresa: ADR }),
  rand({ hg: '30', cad: '300', nume: '=CMD (fictiv)', adresa: ADR }),
  rand({ hg: '31', cad: '301' }),
  rand({ hg: '40', cad: '400', nume: 'DUBLU (fictiv)', adresa: ADR }),
  rand({ hg: '40', cad: '400', nume: 'DUBLU (fictiv)', adresa: 'Jud. Mehedinti, Com. Husnicioara, Sat Altul' }),
]
const PARCELE = [
  { id: 'p1', cheie_sursa: 'HUS|10|100|5', id_parcela: 'T1-HUS-0010', uat3: 'HUS', poz_hg: '10' },
  { id: 'p2', cheie_sursa: 'BAL|7|700|', id_parcela: 'T1-BAL-0007', uat3: 'BAL', poz_hg: '7' },
  { id: 'p3', cheie_sursa: 'HUS|20|200|', id_parcela: 'T1-HUS-0020', uat3: 'HUS', poz_hg: '20' },
  { id: 'p4', cheie_sursa: 'HUS|30|300|', id_parcela: 'T1-HUS-0030', uat3: 'HUS', poz_hg: '30' },
  { id: 'p5', cheie_sursa: 'HUS|40|400|', id_parcela: 'T1-HUS-0040', uat3: 'HUS', poz_hg: '40' },
]
const DETINATORI = [{ parcela_id: 'p1', nume_normalizat: 'POPESCU ION (FICTIV)' }]
const pregateste = () => { const parsat = parseazaUtilizatori(fisier(DATE), { uats: UATS }); return { parsat, plan: planUtilizatori(parsat.candidati, { parcele: PARCELE, detinatori: DETINATORI }) } }

describe('totaluriImport / totaluriPeUat', () => {
  it('cifrele previzualizării, pe categorii', () => {
    const { parsat, plan } = pregateste()
    expect(totaluriImport(parsat, plan)).toEqual({
      randuri: 12, cu_utilizator: 11, in_afara_proiectului: 1, fara_cheie: 1, dubluri_fisier: 1, candidati: 8,
      noi: 4, persoane_noi: 3, parcele_noi: 4, deja_detinatori: 1, parcela_negasita: 1, coliziuni: 1, exclusi: 1,
      potrivire_hg: 1, cu_adresa: 4, cu_telefon: 1,
    })
  })
  it('tabelul pe UAT: UAT-urile proiectului, fără cele din afară', () => {
    const { parsat, plan } = pregateste()
    const t = Object.fromEntries(totaluriPeUat(parsat, plan, UATS).map(u => [u.uat3, u]))
    expect(Object.keys(t)).toEqual(['HUS', 'BAL'])
    expect(t.HUS).toMatchObject({ candidati: 7, noi: 3, persoane: 3, potrivire_hg: 1, deja: 1, negasite: 1, coliziuni: 1, fara_cheie: 0, dubluri: 1 })
    expect(t.BAL).toMatchObject({ candidati: 1, noi: 1, persoane: 1, deja: 0, fara_cheie: 1 })
  })
})

describe('randuriRaport', () => {
  it('fiecare rând Excel cu utilizator apare o dată, cu categoria și motivul', () => {
    const { parsat, plan } = pregateste()
    const r = randuriRaport(parsat, plan)
    expect(r.map(x => [x.rand, x.categorie])).toEqual([
      [4, 'nou'], [5, 'nou'], [6, 'nou'], [7, 'deja'], [8, 'in_afara'], [9, 'negasita'], [10, 'fara_cheie'], [11, 'dublura'], [12, 'nou'], [14, 'exclus'], [15, 'coliziune'],
    ])
    const dupa = Object.fromEntries(r.map(x => [x.rand, x]))
    expect(dupa[4]).toMatchObject({ motiv: MOTIV_NOU, potrivire: 'cheie', id_parcela: 'T1-HUS-0010', cu_adresa: 'da', cu_telefon: 'nu' })
    expect(dupa[6]).toMatchObject({ motiv: MOTIV_NOU_HG, potrivire: 'hg', id_parcela: 'T1-HUS-0020', cu_telefon: 'da', nume: 'ȘTEFĂNESCU ȚICU (fictiv)' })
    expect(dupa[11].motiv).toMatch(/rândul 4/)
    expect(dupa[14].motiv).toMatch(/rândul 15/)
    expect(dupa[15].motiv).toMatch(/adrese diferite.*rândul ales: 14/)
    expect(dupa[8]).toMatchObject({ uat: 'Armeniș', nume: '' })
  })
})

describe('stareDupaScriere', () => {
  it('scris = acum deținător activ în BD; încă nou = NESCRIS cu motivul din lot; fără recitire = necunoscută', () => {
    const { parsat, plan } = pregateste()
    // după scriere (simulat): 4, 5, 12 sunt în BD; rândul 6 (HG) nu s-a scris — parcela s-a schimbat
    const detinatoriDupa = [...DETINATORI, { parcela_id: 'p1', nume_normalizat: 'IONESCU ANA (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'IONESCU ANA (FICTIV)' }, { parcela_id: 'p4', nume_normalizat: '=CMD (FICTIV)' }]
    const planDupa = planUtilizatori(parsat.candidati, { parcele: PARCELE, detinatori: detinatoriDupa })
    const lot = { diferente: { schimbate_la_scriere: [{ rand: 6, motiv: 'parcela s-a schimbat între plan și scriere' }] } }
    const m = stareDupaScriere(plan, planDupa, lot)
    expect([...m.entries()]).toEqual([[4, 'în BD: utilizator activ pe parcelă'], [5, 'în BD: utilizator activ pe parcelă'], [6, 'NESCRIS: parcela s-a schimbat între plan și scriere'], [12, 'în BD: utilizator activ pe parcelă']])
    expect(stareDupaScriere(plan, null, lot).get(4)).toMatch(/^necunoscută/)
    // planul refăcut din BD: cei scriși sunt acum „deja deținători”, rămâne nou doar rândul nescris (6)
    expect(planDupa.statistici).toMatchObject({ noi: 1, deja_detinatori: 4 })
  })
})

describe('csvRaportUtilizatori', () => {
  it('UTF-8 cu BOM, „;”, CRLF, caractere românești, toate categoriile; formulele neutralizate ca la exporturile existente', () => {
    const { parsat, plan } = pregateste()
    const csv = csvRaportUtilizatori(randuriRaport(parsat, plan))
    expect(csv.charCodeAt(0)).toBe(0xFEFF)
    const linii = csv.slice(1).split('\r\n')
    expect(linii.at(-1)).toBe('')
    expect(linii[0]).toBe('Rând Excel;Categorie;UAT;Parcelă (id);Cheie (UAT|HG|cadastru|tarla);Potrivire;Nume utilizator;Cu adresă;Cu telefon;Motiv')
    expect(linii).toHaveLength(1 + 11 + 1)
    expect(csv).toContain('ȘTEFĂNESCU ȚICU (fictiv)')
    for (const cat of ['Nou (se importă)', 'Deja deținător pe parcelă', 'Parcelă negăsită', 'Coliziune', 'Exclus', 'Dublură în fișier', 'Fără cheie', 'În afara proiectului']) expect(csv).toContain(cat)
    expect(linii.find(l => l.startsWith('6;'))).toContain(';poziție HG;')
    const r12 = linii.find(l => l.startsWith('12;'))
    expect(r12).toContain(`;"'=CMD (fictiv)";`)
    expect(r12).toContain(';cheie exactă;')
  })
  it('valorile care încep cu = + - @ (și după spații) primesc apostrof; textul obișnuit rămâne neatins', () => {
    const r = ['=1+1', '+40711', '-2', '@SUM(1)', ' =x'].map((nume, i) => ({ rand: i + 4, eticheta: 'Nou (se importă)', uat: 'HUS', id_parcela: 'X', cheie_sursa: 'HUS|1||', potrivire: 'cheie', nume, cu_adresa: 'da', cu_telefon: 'nu', motiv: 'm' }))
    const linii = csvRaportUtilizatori(r).slice(1).split('\r\n')
    expect(linii.slice(1, 6).map(l => l.split(';')[6])).toEqual([`"'=1+1"`, `"'+40711"`, `"'-2"`, `"'@SUM(1)"`, `"' =x"`])
    expect(linii[1].split(';')[4]).toBe('HUS|1||')
  })
  it('după scriere: coloana „După scriere (din BD)”', () => {
    const { parsat, plan } = pregateste()
    const m = stareDupaScriere(plan, null, null)
    const csv = csvRaportUtilizatori(randuriRaport(parsat, plan, m), { dupa: true })
    const linii = csv.slice(1).split('\r\n')
    expect(linii[0].endsWith(';Motiv;După scriere (din BD)')).toBe(true)
    expect(linii.find(l => l.startsWith('4;'))).toMatch(/necunoscută — recitirea din BD/)
    expect(linii.find(l => l.startsWith('7;'))).toMatch(/neschimbat \(nu era de scris\)$/)
  })
})
