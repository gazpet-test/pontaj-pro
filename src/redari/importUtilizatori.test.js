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
    expect(p.deja_detinatori).toMatchObject([{ rand: 5, uat3: 'HUS', id_parcela: 'T3-HUS-0010', parcela_id: 'p1', motiv: 'persoana e deja deținător pe aceeași parcelă' }])
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
  it('r2 (Jak P1-1): unicitatea HG se judecă pe TOATE parcelele active, și pe cele fără cheie', () => {
    const c = [{ rand: 11, uat3: 'HUS', cheie_sursa: 'HUS|30|X|', poz_hg: '30', nume: 'F', nume_normalizat: 'F', contact: { adresa_cunoscuta: true, telefon: null } }]
    const p = planUtilizatori(c, { parcele: [{ id: 'p6', cheie_sursa: 'HUS|30|1|', uat3: 'HUS', poz_hg: '30' }, { id: 'p7', cheie_sursa: null, uat3: 'HUS', poz_hg: '30' }] })
    expect(p.noi).toEqual([]); expect(p.parcela_negasita.map(x => x.rand)).toEqual([11])
  })
  it('r2 (Jak P1-3): două rânduri cu chei diferite care ajung (prin HG) la aceeași parcelă și persoană → un singur nou + coliziune', () => {
    const c = [{ rand: 12, uat3: 'HUS', cheie_sursa: 'HUS|40|1|', poz_hg: '40', nume: 'G', nume_normalizat: 'G', contact: { adresa_cunoscuta: true, telefon: null } },
               { rand: 13, uat3: 'HUS', cheie_sursa: 'HUS|40|ALT|', poz_hg: '40', nume: 'G', nume_normalizat: 'G', contact: { adresa_cunoscuta: true, telefon: null } }]
    const p = planUtilizatori(c, { parcele: [{ id: 'p8', cheie_sursa: 'HUS|40|1|', uat3: 'HUS', poz_hg: '40' }] })
    expect(p.noi.map(n => n.rand)).toEqual([12]); expect(p.coliziuni).toMatchObject([{ rand: 13, rand_ales: 12 }]); expect(p.statistici.coliziuni).toBe(1)
  })
  it('două parcele active cu aceeași cheie → refuz (nimic nu se importă)', () => {
    expect(() => planUtilizatori(candidati, { parcele: [...parcele, { id: 'p3', cheie_sursa: 'BAL|7|700|' }] })).toThrow(/aceeași cheie/)
  })
})

// client Supabase fals: inserturi / update-uri / citiri keyset (.in().is().gt().order().limit()); limitaServer simulează o limită de server
function clientFals({ existentiDupaPlan = [], esueazaContacte = 0, limitaServer = Infinity, unic = true } = {}) {
  const tabele = { red_detinatori: [...existentiDupaPlan], red_detinatori_contact: [], red_import_loturi: [] }
  let n = 0, esecuriRamase = esueazaContacte
  const jurnal = { inserturi: [], update: [] }
  const from = (tab) => {
    const q = { _f: [], _lim: Infinity }
    q.select = () => q; q.order = () => q; q.not = () => q; q.eq = () => q
    q.in = (col, vals) => { q._f.push(r => vals.includes(r[col])); return q }
    q.is = (col, v) => { q._f.push(r => (r[col] ?? null) === v); return q }
    q.gt = (col, v) => { q._f.push(r => String(r[col]) > String(v)); return q }
    q.limit = async (k) => ({ data: (tabele[tab] || []).filter(r => q._f.every(f => f(r))).sort((a, b) => String(a.id) < String(b.id) ? -1 : 1).slice(0, Math.min(k, limitaServer)), error: null })
    q.insert = (rows) => {
      const arr = (Array.isArray(rows) ? rows : [rows]).map(r => ({ id: `${tab}-${String(++n).padStart(4, '0')}`, sters_la: null, ...r }))
      let rez = { data: arr, error: null }
      if (tab === 'red_detinatori_contact' && esecuriRamase > 0) { esecuriRamase--; rez = { data: null, error: { message: 'contact picat' } } }
      else if (tab === 'red_detinatori' && unic && arr.some(a => tabele.red_detinatori.some(d => !d.sters_la && d.parcela_id === a.parcela_id && d.nume_normalizat === a.nume_normalizat))) rez = { data: null, error: { code: '23505', message: 'duplicate key' } }
      else { tabele[tab].push(...arr); jurnal.inserturi.push([tab, arr.length]) }
      return { select: () => ({ single: async () => ({ data: rez.data?.[0] ?? null, error: rez.error }) }), then: (res) => res(rez) }
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
  it('eroare la contacte → lot „esuat”, eroarea originală urcă, cu lotId; deținătorii scriși apar în lot', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 1 })
    const e = await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/contact picat/)
    expect(e.lotId).toBe(tabele.red_import_loturi[0].id)
    expect(tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', detinatori_noi: 2 })
  })
  it('r2 (Jak P1-2): reluarea după un import întrerupt completează contactele lipsă ale utilizatorilor scriși de acest import', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 1 })
    await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(() => {})
    expect(tabele.red_detinatori).toHaveLength(2); expect(tabele.red_detinatori_contact).toHaveLength(0)
    // a doua rulare: planul refăcut din BD îi vede ca „deja deținători” — contactele se repară, nimic nu se dublează
    const din = [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'B (FICTIV)' }]
    const plan2 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: din })
    expect(plan2.noi).toHaveLength(0); expect(plan2.deja_detinatori).toHaveLength(2)
    const r = await scrieUtilizatori(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 0, contacteNoi: 2 })
    expect(tabele.red_detinatori).toHaveLength(2); expect(tabele.red_detinatori_contact).toHaveLength(2)
    // a treia rulare: nimic de făcut
    expect(await scrieUtilizatori(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 0, contacteNoi: 0 })
  })
  it('r2: contactul unui proprietar existent (altă sursă) NU se atinge la reluare', async () => {
    const { supabase, tabele } = clientFals({ existentiDupaPlan: [{ id: 'd0', parcela_id: 'p1', nume_normalizat: 'A (FICTIV)', calitate: 'proprietar', sursa_date: 'TGZ', sters_la: null }] })
    const plan3 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }] })
    await scrieUtilizatori(supabase, plan3, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(tabele.red_detinatori_contact.map(c => c.detinator_id)).not.toContain('d0')
  })
  it('r2: conflict UNIQUE (alt import în paralel) → mesaj clar de reluare', async () => {
    const { supabase, tabele } = clientFals()
    tabele.red_detinatori.push({ id: 'zz', parcela_id: 'p1', nume_normalizat: 'A (FICTIV)', sters_la: null, ascuns: true })
    // recitirea îl vede și îl sare; forțăm cursa scoțându-l din recitire printr-un filtru: simulăm apariția lui DUPĂ recitire
    const plan4 = { ...plan }
    const orig = supabase.from
    let citiri = 0
    supabase.from = (tab) => { const q = orig(tab); if (tab === 'red_detinatori') { const lim = q.limit; q.limit = async (k) => { citiri++; const r = await lim(k); return citiri === 1 ? { ...r, data: r.data.filter(d => !d.ascuns) } : r } } return q }
    const e = await scrieUtilizatori(supabase, plan4, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/alt import a scris între timp/)
  })
  it('r2 (Jak P2-4): citirea keyset nu se oprește la o limită de server mai mică decât pagina', async () => {
    const { supabase, tabele } = clientFals({ limitaServer: 1 })
    const r = await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true, pagina: 1000 })
    expect(r.detinatoriNoi).toBe(2); expect(tabele.red_detinatori_contact).toHaveLength(2)
  })
  it('fără proiect / versiune → refuz înainte de orice scriere', async () => {
    const { supabase, jurnal } = clientFals()
    await expect(scrieUtilizatori(supabase, plan, { versiune: 'v', permite: true })).rejects.toThrow(/proiectId/)
    await expect(scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: ' ', permite: true })).rejects.toThrow(/versiunea/)
    expect(jurnal.inserturi).toEqual([])
  })
})
