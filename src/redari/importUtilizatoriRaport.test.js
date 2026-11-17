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

// r2 (Jak PR1120 P2): starea după scriere din parcela confirmată + calitate + contact + marcajul lotului; motivul din lot are prioritate
const LOT_ID = 'lot-fictiv-1'
const scris = (id, parcela_id, nume_normalizat, extra = {}) => ({ id, parcela_id, nume_normalizat, calitate: 'utilizator', sursa_date: `TGZ_UTILIZATORI: … rândul x; lot ${LOT_ID}`, ...extra })
const rec = (detinatori, cuContact = detinatori.map(d => d.id), deVerificat = []) => ({ detinatori, contacte: new Map(cuContact.map(id => [id, 't'])), deVerificat })
describe('stareDupaScriere', () => {
  it('stările distincte: scris / contact lipsă / de verificat / există ca utilizator / altă calitate / țintă schimbată / oprit / necunoscut', () => {
    const { plan } = pregateste()
    const r = rec([
      scris('d4', 'p1', 'IONESCU ANA (FICTIV)'),                                                     // 4: scris, cu contact
      scris('d5', 'p2', 'IONESCU ANA (FICTIV)'),                                                     // 5: scris, fără contact
      scris('d12', 'p4', '=CMD (FICTIV)'),                                                          // 12: scris, ținta schimbată după scriere
    ], ['d4', 'd12'], [{ id: 'd12', motiv: 'de verificat: ținta s-a schimbat în timpul importului (parcela nu mai e activă în proiect)' }])
    const lot = { stare: 'finalizat', diferente: { schimbate_la_scriere: [{ rand: 6, motiv: 'parcela s-a schimbat între plan și scriere (poziția HG nu mai e unică în UAT) — nescris' }] } }
    const m = stareDupaScriere(plan, r, lot, LOT_ID)
    expect(Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.cod]))).toEqual({ 4: 'scris', 5: 'scris_fara_contact', 6: 'nescris_tinta', 12: 'de_verificat' })
    expect(m.get(4)).toEqual({ cod: 'scris', text: 'scris de această operație', id: 'd4', contact: true })
    expect(m.get(6).text).toBe('nescris: țintă schimbată: parcela s-a schimbat între plan și scriere (poziția HG nu mai e unică în UAT) — nescris')
    expect(m.get(12).text).toMatch(/^de verificat: ținta s-a schimbat în timpul importului/)
    // fără recitire: necunoscut pentru toate rândurile noi (nimic declarat scris fără dovadă)
    expect([...stareDupaScriere(plan, null, lot, LOT_ID).values()].every(v => v.cod === 'necunoscut')).toBe(true)
    // lot eșuat, nimic în BD: oprit; lot finalizat, nimic în BD: necunoscut
    expect(stareDupaScriere(plan, rec([]), { stare: 'esuat', diferente: {} }, LOT_ID).get(4).cod).toBe('nescris_oprit')
    expect(stareDupaScriere(plan, rec([]), { stare: 'finalizat', diferente: {} }, LOT_ID).get(4).cod).toBe('necunoscut')
  })
  it('scenariul (i) al recenzentului: alt operator adaugă persoana ca PROPRIETAR, importul o sare → „există deja cu altă calitate”, nu „utilizator activ”', () => {
    const { plan } = pregateste()
    const m = stareDupaScriere(plan, rec([{ id: 'dx', parcela_id: 'p1', nume_normalizat: 'IONESCU ANA (FICTIV)', calitate: 'proprietar', sursa_date: 'manual' }]), { stare: 'finalizat', diferente: {} }, LOT_ID)
    expect(m.get(4)).toEqual({ cod: 'exista_alta_calitate', text: 'există deja cu altă calitate — nescris („proprietar”)', id: 'dx' })
    // același om adăugat ca utilizator de altă operație (fără marcajul acestui lot) → „există deja ca utilizator”, nu „scris”
    const m2 = stareDupaScriere(plan, rec([scris('dy', 'p1', 'IONESCU ANA (FICTIV)', { sursa_date: 'TGZ_UTILIZATORI: … rândul 4; lot alt-lot' })]), { stare: 'finalizat', diferente: {} }, LOT_ID)
    expect(m2.get(4).cod).toBe('exista_utilizator')
  })
  it('scenariul (ii): ținta inițială a dispărut, persoana e acum pe ALTĂ parcelă, lotul spune „nescris” → nescris: țintă schimbată (nu „scris”)', () => {
    const { plan } = pregateste()
    // rândul 6 fusese potrivit după HG pe p3; acum persoana există pe p9 (alt rând, altă parcelă)
    const m = stareDupaScriere(plan, rec([scris('d9', 'p9', plan.noi.find(n => n.rand === 6).nume_normalizat)]),
      { stare: 'finalizat', diferente: { schimbate_la_scriere: [{ rand: 6, motiv: 'parcela s-a schimbat' }] } }, LOT_ID)
    expect(m.get(6).cod).toBe('nescris_tinta')
    // chiar dacă cineva ar fi pus-o pe parcela confirmată fără marcaj, motivul din lot are prioritate față de „există deja”
    const m2 = stareDupaScriere(plan, rec([{ id: 'dz', parcela_id: 'p3', nume_normalizat: plan.noi.find(n => n.rand === 6).nume_normalizat, calitate: 'utilizator', sursa_date: 'manual' }]),
      { stare: 'finalizat', diferente: { schimbate_la_scriere: [{ rand: 6, motiv: 'parcela s-a schimbat' }] } }, LOT_ID)
    expect(m2.get(6).cod).toBe('nescris_tinta')
  })
  it('potrivirile HG neconfirmate → „neimportat … neconfirmată”; contactul completat al unui „deja deținător” doar cu dovadă din lot + BD', () => {
    const { plan } = pregateste()
    const hg = plan.noi.filter(n => n.potrivire === 'hg')
    const planScris = { ...plan, hg_neconfirmate: hg }
    const dProp = { id: 'd-prop', parcela_id: 'p1', nume_normalizat: 'POPESCU ION (FICTIV)', calitate: 'proprietar', sursa_date: 'TGZ' }
    const m = stareDupaScriere(planScris, rec([dProp]), { stare: 'finalizat', diferente: { contacte_scrise: ['d-prop'] } }, LOT_ID)
    expect(m.get(6).cod).toBe('hg_neconfirmat')
    expect(m.get(7)).toEqual({ cod: 'contact_completat', text: 'contact completat de această operație', id: 'd-prop', contact: true })
    expect(stareDupaScriere(planScris, rec([dProp], []), { stare: 'finalizat', diferente: { contacte_scrise: ['d-prop'] } }, LOT_ID).get(7)).toBeUndefined()
  })
})

// r3 (Jak r2 P2-1): contactele „deja deținătorilor” se judecă după intenția consemnată + clasificarea din BD; niciodată „neschimbat” dacă atribuirea lipsește
describe('stareDupaScriere — r3: completarea contactelor', () => {
  const dU = { id: 'd-u7', parcela_id: 'p1', nume_normalizat: 'POPESCU ION (FICTIV)', calitate: 'utilizator', sursa_date: 'TGZ_UTILIZATORI: … rândul 7; lot lot-vechi' }
  const recCu = (cc, cuContact = ['d-u7']) => ({ detinatori: [dU], contacte: new Map(cuContact.map(id => [id, 't'])), deVerificat: [], contacteIntentie: [{ detinator_id: 'd-u7', rand: 7 }], contacteClasificate: cc })
  const lot = { stare: 'esuat', diferente: {} }
  it('răspuns pierdut, contact existent → „necunoscut — de verificat” (în CSV, nu „neschimbat”)', () => {
    const { parsat, plan } = pregateste()
    const m = stareDupaScriere(plan, recCu({ scrise: [], necunoscute: ['d-u7'], nescrise: [], aparute: [] }), lot, LOT_ID)
    expect(m.get(7)).toEqual({ cod: 'necunoscut', text: 'necunoscut — de verificat (contactul există acum, dar răspunsul la completare s-a pierdut: poate fi scris de această operație sau de altcineva)', id: 'd-u7', contact: true })
    const r7 = csvRaportUtilizatori(randuriRaport(parsat, plan, m), { dupa: true }).split('\r\n').find(l => l.startsWith('7;'))
    expect(r7).not.toMatch(/neschimbat/)
    expect(r7.endsWith(';d-u7;da')).toBe(true)
  })
  it('confirmat → completat; din intenție fără contact → necompletat; apărut din altă parte → necompletat, cu detaliu; fără recitire → necunoscut', () => {
    const { plan } = pregateste()
    expect(stareDupaScriere(plan, recCu({ scrise: ['d-u7'], necunoscute: [], nescrise: [], aparute: [] }), lot, LOT_ID).get(7).cod).toBe('contact_completat')
    expect(stareDupaScriere(plan, recCu({ scrise: [], necunoscute: [], nescrise: ['d-u7'], aparute: [] }, []), lot, LOT_ID).get(7))
      .toEqual({ cod: 'contact_nescris', text: 'contact de completat, necompletat de această operație', id: 'd-u7', contact: false })
    expect(stareDupaScriere(plan, recCu({ scrise: [], necunoscute: [], nescrise: [], aparute: ['d-u7'] }), lot, LOT_ID).get(7).text)
      .toBe('contact de completat, necompletat de această operație (contactul a apărut între timp din altă parte)')
    const faraRec = stareDupaScriere(plan, null, lot, LOT_ID, { contacteIntentie: [{ detinator_id: 'd-u7', rand: 7 }] })
    expect(faraRec.get(7)).toEqual({ cod: 'necunoscut', text: 'necunoscut — de verificat (contactul era de completat; recitirea din BD după scriere a eșuat)', id: 'd-u7' })
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
  it('r2: valorile care încep cu TAB / CR (singure sau urmate de formulă) sunt neutralizate și citate', () => {
    const r = ['\t=1+1', '\r=1+1', '\tTEXT', '\rTEXT', 'A\tB'].map((nume, i) => ({ rand: i + 4, eticheta: 'Nou (se importă)', uat: 'HUS', id_parcela: 'X', cheie_sursa: 'HUS|1||', potrivire: 'cheie', nume, cu_adresa: 'da', cu_telefon: 'nu', motiv: 'm' }))
    const csv = csvRaportUtilizatori(r)
    // fiecare valoare care începe cu TAB / CR primește apostrof și ghilimele; TAB-ul din interior rămâne text
    expect(csv).toContain(`;"'\t=1+1";`); expect(csv).toContain(`;"'\r=1+1";`)
    expect(csv).toContain(`;"'\tTEXT";`); expect(csv).toContain(`;"'\rTEXT";`)
    expect(csv).toContain(';A\tB;')
  })
  it('după scriere: coloanele „După scriere (din BD)”, „ID deținător”, „Contact în BD”', () => {
    const { parsat, plan } = pregateste()
    const m = stareDupaScriere(plan, rec([scris('d4', 'p1', 'IONESCU ANA (FICTIV)')]), { stare: 'esuat', diferente: {} }, LOT_ID)
    const csv = csvRaportUtilizatori(randuriRaport(parsat, plan, m), { dupa: true })
    const linii = csv.slice(1).split('\r\n')
    expect(linii[0].endsWith(';Motiv;După scriere (din BD);ID deținător;Contact în BD')).toBe(true)
    expect(linii.find(l => l.startsWith('4;')).endsWith(';scris de această operație;d4;da')).toBe(true)
    expect(linii.find(l => l.startsWith('5;')).endsWith(';nescris: importul s-a oprit înainte — refaceți previzualizarea și reluați;;')).toBe(true)
    expect(linii.find(l => l.startsWith('7;'))).toMatch(/neschimbat \(nu era de scris\);;$/)
    const necunoscut = csvRaportUtilizatori(randuriRaport(parsat, plan, stareDupaScriere(plan, null, null, LOT_ID)), { dupa: true })
    expect(necunoscut.slice(1).split('\r\n').find(l => l.startsWith('4;'))).toMatch(/necunoscut — de verificat \(recitirea din BD după scriere a eșuat/)
  })
})
