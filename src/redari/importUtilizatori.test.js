// Redări PR4 (juridic#040): importul utilizatorilor / arendașilor — citire, plan, scriere (client fals). Date fictive, fără PII.
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaUtilizatori, planUtilizatori, scrieUtilizatori, telefonValid, IMPORT_UTILIZATORI_ACTIV, CALITATE_UTILIZATOR, SURSA_UTILIZATORI, COL } from './importUtilizatori.js'

const UATS = [{ id: 'u1', nume: 'Husnicioara', uat3: 'HUS' }, { id: 'u2', nume: 'Bâlvănești', uat3: 'BAL' }]
// un rând de date: 27 de coloane, completate doar cele folosite
const rand = ({ uat = '02Husnicioara', hg = '', tarla = '', cad = '', nume = '', adresa = '', tel = '' }) => {
  const r = Array(27).fill('')
  r[COL.uat] = uat; r[COL.poz_hg] = hg; r[COL.tarla] = tarla; r[COL.nr_cadastral] = cad; r[COL.nume] = nume; r[COL.adresa] = adresa; r[COL.telefon] = tel
  return r
}
const fisier = (date) => {
  const antet = [Array(27).fill('DATE'), Array(27).fill('EN'), Array(27).fill('RO')]
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...antet, ...date]), 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}

describe('parseazaUtilizatori', () => {
  it('ia doar rândurile cu utilizator, din UAT-urile proiectului, cu identitate; dublurile din fișier o singură dată', () => {
    const r = parseazaUtilizatori(fisier([
      rand({ hg: '10', tarla: '5', cad: '100', nume: 'POPESCU ION (fictiv)', adresa: 'Jud. Mehedinti, Com. Husnicioara, Sat Fictiv', tel: '0711 111 111' }),
      rand({ hg: '10', tarla: '5', cad: '100', nume: 'Popescu  Ion (fictiv)' }),                       // aceeași persoană, aceeași parcelă
      rand({ hg: '11', tarla: '5', cad: '101' }),                                                     // fără utilizator
      rand({ uat: '18Armeniș', hg: '1', cad: '1', nume: 'ALTCINEVA (fictiv)' }),                      // UAT din afara proiectului
      rand({ uat: '06Bâlvănești', hg: '#', cad: '##', nume: 'FARA CHEIE (fictiv)' }),                  // fără identitate
      rand({ uat: '06Bâlvănești', hg: '7', cad: '700', nume: 'IONESCU ANA (fictiv)', tel: '12' }),     // telefon invalid, fără adresă
      rand({ uat: '' }),                                                                              // rând gol / subsol
    ]), { uats: UATS })
    expect(r.statistici).toMatchObject({ randuri: 6, cu_utilizator: 5, in_afara_proiectului: 1, fara_cheie: 1, dubluri_fisier: 1, candidati: 2 })
    const [a, b] = r.candidati
    expect(a).toMatchObject({ uat3: 'HUS', cheie_sursa: 'HUS|10|100|5', poz_hg: '10', nume_normalizat: 'POPESCU ION (FICTIV)' })
    expect(a.contact).toMatchObject({ adresa_sat: 'Fictiv', adresa_comuna: 'Husnicioara', adresa_judet: 'Mehedinti', adresa_cunoscuta: true, telefon: '0711 111 111' })
    expect(b).toMatchObject({ uat3: 'BAL', cheie_sursa: 'BAL|7|700|' })
    expect(b.contact).toMatchObject({ adresa_cunoscuta: false, telefon: null })
    expect(r.in_afara_proiectului).toEqual([{ rand: 7, uat: 'Armeniș' }])
  })
  it('telefonValid: cel puțin 9 cifre', () => {
    expect(telefonValid('0711-111-111')).toBe('0711-111-111')
    for (const v of ['', null, '12345678', '#']) expect(telefonValid(v)).toBeNull()
  })
})

describe('planUtilizatori', () => {
  const candidati = [
    { rand: 4, uat3: 'HUS', cheie_sursa: 'HUS|10|100|5', nume: 'A', nume_normalizat: 'A', contact: { adresa_cunoscuta: true, telefon: null } },
    { rand: 5, uat3: 'HUS', cheie_sursa: 'HUS|10|100|5', nume: 'B', nume_normalizat: 'B', contact: { adresa_cunoscuta: false, telefon: '0711111111' } },
    { rand: 6, uat3: 'HUS', cheie_sursa: 'HUS|99|999|', nume: 'C', nume_normalizat: 'C', contact: { adresa_cunoscuta: true, telefon: null } },
    { rand: 7, uat3: 'BAL', cheie_sursa: 'BAL|7|700|', nume: 'A', nume_normalizat: 'A', contact: { adresa_cunoscuta: true, telefon: null } },
  ]
  const parcele = [{ id: 'p1', cheie_sursa: 'HUS|10|100|5', id_parcela: 'T3-HUS-0010' }, { id: 'p2', cheie_sursa: 'BAL|7|700|', id_parcela: 'T5-BAL-0007' }]
  it('nou / deja deținător / parcelă negăsită; aceeași persoană pe două parcele = 2 rânduri, 1 persoană', () => {
    const p = planUtilizatori(candidati, { parcele, detinatori: [{ parcela_id: 'p1', nume_normalizat: 'B' }] })
    expect(p.noi.map(n => [n.rand, n.parcela_id, n.potrivire])).toEqual([[4, 'p1', 'cheie'], [7, 'p2', 'cheie']])
    expect(p.deja_detinatori).toEqual([{ rand: 5, uat3: 'HUS', id_parcela: 'T3-HUS-0010', motiv: 'persoana e deja deținător pe aceeași parcelă' }])
    expect(p.parcela_negasita.map(x => x.rand)).toEqual([6])
    expect(p.statistici).toMatchObject({ candidati: 4, noi: 2, persoane_noi: 1, deja_detinatori: 1, parcela_negasita: 1, cu_adresa: 2, cu_telefon: 0 })
  })
  it('fără cheie exactă: poziția HG unică în UAT potrivește (raportat „hg”); HG ne-unic → negăsită', () => {
    const c = [{ rand: 9, uat3: 'HUS', cheie_sursa: 'HUS|10|ALT|', poz_hg: '10', nume: 'D', nume_normalizat: 'D', contact: { adresa_cunoscuta: true, telefon: null } },
               { rand: 10, uat3: 'HUS', cheie_sursa: 'HUS|20|X|', poz_hg: '20', nume: 'E', nume_normalizat: 'E', contact: { adresa_cunoscuta: true, telefon: null } }]
    const pc = [{ id: 'p1', cheie_sursa: 'HUS|10|100|5', uat3: 'HUS', poz_hg: '10' }, { id: 'p4', cheie_sursa: 'HUS|20|1|', uat3: 'HUS', poz_hg: '20' }, { id: 'p5', cheie_sursa: 'HUS|20|2|', uat3: 'HUS', poz_hg: '20' }]
    const p = planUtilizatori(c, { parcele: pc })
    expect(p.noi.map(n => [n.rand, n.parcela_id, n.potrivire])).toEqual([[9, 'p1', 'hg']])
    expect(p.parcela_negasita.map(x => x.rand)).toEqual([10])
    expect(p.statistici.potrivire_hg).toBe(1)
  })
  it('două parcele active cu aceeași cheie → refuz (nimic nu se importă)', () => {
    expect(() => planUtilizatori(candidati, { parcele: [...parcele, { id: 'p3', cheie_sursa: 'BAL|7|700|' }] })).toThrow(/aceeași cheie/)
  })
})

// client Supabase fals: inserturi / update-uri / citiri cu .in().is().order().range()
function clientFals({ existentiDupaPlan = [], esueazaContacte = false } = {}) {
  const tabele = { red_detinatori: [...existentiDupaPlan], red_detinatori_contact: [], red_import_loturi: [] }
  let n = 0
  const jurnal = { inserturi: [], update: [] }
  const from = (tab) => {
    const q = { _tab: tab, _f: [] }
    q.select = () => q; q.order = () => q; q.not = () => q; q.eq = () => q
    q.in = (col, vals) => { q._f.push(r => vals.includes(r[col])); return q }
    q.is = (col, v) => { q._f.push(r => (r[col] ?? null) === v); return q }
    q.range = async (a, b) => ({ data: (tabele[tab] || []).filter(r => q._f.every(f => f(r))).slice(a, b + 1), error: null })
    q.insert = (rows) => {
      if (tab === 'red_detinatori_contact' && esueazaContacte) return { then: (res) => res({ data: null, error: { message: 'contact picat' } }) }
      const arr = (Array.isArray(rows) ? rows : [rows]).map(r => ({ id: `${tab}-${++n}`, sters_la: null, ...r }))
      tabele[tab].push(...arr); jurnal.inserturi.push([tab, arr.length])
      const rez = { data: arr, error: null }
      return { select: () => ({ single: async () => ({ data: arr[0], error: null }) }), then: (res) => res(rez) }
    }
    q.update = (v) => ({ eq: async (col, val) => { jurnal.update.push(v); const r = tabele[tab].find(x => x[col] === val); Object.assign(r, v); return { data: null, error: null } } })
    return q
  }
  return { supabase: { from }, tabele, jurnal }
}

describe('scrieUtilizatori', () => {
  const plan = planUtilizatori([
    { rand: 4, uat3: 'HUS', cheie_sursa: 'K1', nume: 'A (fictiv)', nume_normalizat: 'A (FICTIV)', contact: { adresa_strada: null, adresa_sat: 'S', adresa_comuna: 'C', adresa_judet: 'J', cod_postal: null, adresa_cunoscuta: true, telefon: null } },
    { rand: 5, uat3: 'HUS', cheie_sursa: 'K2', nume: 'B (fictiv)', nume_normalizat: 'B (FICTIV)', contact: { adresa_strada: null, adresa_sat: null, adresa_comuna: null, adresa_judet: null, cod_postal: null, adresa_cunoscuta: false, telefon: null } },
  ], { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: [] })
  it('oprit implicit până la PR3 (IMPORT_UTILIZATORI_ACTIV = false)', async () => {
    expect(IMPORT_UTILIZATORI_ACTIV).toBe(false)
    const { supabase, jurnal } = clientFals()
    await expect(scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'v' })).rejects.toThrow(/oprit/)
    expect(jurnal.inserturi).toEqual([])
  })
  it('scrie utilizatorii (calitate utilizator) + contactele, lot finalizat; cine a apărut între timp pe parcelă e sărit', async () => {
    const { supabase, tabele } = clientFals({ existentiDupaPlan: [{ id: 'd0', parcela_id: 'p2', nume_normalizat: 'B (FICTIV)', sters_la: null }] })
    const r = await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'TGZ 13.07.2026 utilizatori', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 1, contacteNoi: 1, sarite: 1 })
    const nou = tabele.red_detinatori.find(d => d.nume_normalizat === 'A (FICTIV)')
    expect(nou).toMatchObject({ parcela_id: 'p1', calitate: CALITATE_UTILIZATOR, versiune_lista_tgz: 'TGZ 13.07.2026 utilizatori' })
    expect(nou.sursa_date).toMatch(/^TGZ_UTILIZATORI: .*rândul 4$/)
    expect(tabele.red_detinatori_contact).toHaveLength(1)
    expect(tabele.red_detinatori_contact[0]).toMatchObject({ detinator_id: nou.id, adresa_cunoscuta: true, adresa_sat: 'S' })
    expect(tabele.red_import_loturi[0]).toMatchObject({ sursa: SURSA_UTILIZATORI, stare: 'finalizat', detinatori_noi: 1 })
  })
  it('eroare la contacte → lot „esuat”, eroarea originală urcă, cu lotId', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: true })
    const e = await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/contact picat/)
    expect(e.lotId).toBe(tabele.red_import_loturi[0].id)
    expect(tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat' })
  })
  it('fără proiect / versiune → refuz înainte de orice scriere', async () => {
    const { supabase, jurnal } = clientFals()
    await expect(scrieUtilizatori(supabase, plan, { versiune: 'v', permite: true })).rejects.toThrow(/proiectId/)
    await expect(scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: ' ', permite: true })).rejects.toThrow(/versiunea/)
    expect(jurnal.inserturi).toEqual([])
  })
})
