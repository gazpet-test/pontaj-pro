// Redări PR4 (juridic#040): importul utilizatorilor / arendașilor — citire, plan, scriere (client fals). Date fictive, fără PII.
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx-js-style'
import { parseazaUtilizatori, planUtilizatori, scrieUtilizatori, __scrieUtilizatoriTest, telefonValid, IMPORT_UTILIZATORI_ACTIV, CALITATE_UTILIZATOR, SURSA_UTILIZATORI, COL } from './importUtilizatori.js'

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
    // rândul 2 (aceeași persoană, fără adresă / telefon) are alt contact decât rândul 1 → ambele merg în plan (coliziunea le exclude acolo)
    expect(r.statistici).toMatchObject({ randuri: 6, cu_utilizator: 5, in_afara_proiectului: 1, fara_cheie: 1, dubluri_fisier: 0, candidati: 3 })
    const [a, , b] = r.candidati
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
const PARCELE_TEST = [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1', poz_hg: null, sters_la: null, red_uat: { uat3: 'HUS' } }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2', poz_hg: null, sters_la: null, red_uat: { uat3: 'HUS' } }]
const COLOANE = { red_detinatori_contact: ['detinator_id', 'adresa_strada', 'adresa_sat', 'adresa_comuna', 'adresa_judet', 'cod_postal', 'adresa_cunoscuta', 'telefon', 'email'] }
// r2: dupaInsert(tab, randuri, tabele) = o schimbare făcută de „alt operator” imediat după un INSERT comis; pierdeRaspuns = tabela al cărei
// prim INSERT se COMITE, dar răspunsul se pierde (eroare de rețea, fără cod)
function clientFals({ existentiDupaPlan = [], esueazaContacte = 0, limitaServer = Infinity, unic = true, parcele = PARCELE_TEST, contacteExistente = [], dupaInsert = null, pierdeRaspuns = null } = {}) {
  const tabele = { red_detinatori: [...existentiDupaPlan], red_detinatori_contact: [...contacteExistente], red_import_loturi: [], red_parcele: parcele.map(p => ({ ...p })) }
  let n = 0, esecuriRamase = esueazaContacte, pierdut = false
  const jurnal = { inserturi: [], update: [] }
  const from = (tab) => {
    const q = { _f: [], _lim: Infinity }
    q.select = (cols) => { q._cols = String(cols || '*').split(',').map(c => c.trim().replace(/\(.*$/, '')); return q }
    q.not = () => q; q.eq = () => q
    // realist: ordonarea / cursorul pe o coloană inexistentă = eroare ca în PostgREST
    q.order = (col) => { const cols = COLOANE[tab]; if (cols && !cols.includes(col)) q._err = { code: '42703', message: `column ${tab}.${col} does not exist` }; return q }
    q.in = (col, vals) => { q._f.push(r => vals.includes(r[col])); return q }
    q.is = (col, v) => { q._f.push(r => (r[col] ?? null) === v); return q }
    q.gt = (col, v) => { q._f.push(r => String(r[col]) > String(v)); return q }
    q.limit = async (k) => {
      if (q._err) return { data: null, error: q._err }
      const cheie = tab === 'red_detinatori_contact' ? 'detinator_id' : 'id'
      const rows = (tabele[tab] || []).filter(r => q._f.every(f => f(r))).sort((a, b) => String(a[cheie]) < String(b[cheie]) ? -1 : 1).slice(0, Math.min(k, limitaServer))
      // proiecția: doar coloanele cerute (ca PostgREST); red_uat(uat3) rămâne obiect
      return { data: rows.map(r => q._cols && !q._cols.includes('*') ? Object.fromEntries(q._cols.map(c => [c, r[c]])) : r), error: null }
    }
    q.insert = (rows) => {
      const arr = (Array.isArray(rows) ? rows : [rows]).map(r => tab === 'red_detinatori_contact' ? { ...r } : ({ id: `${tab}-${String(++n).padStart(4, '0')}`, sters_la: null, ...r }))
      let rez = { data: arr, error: null }
      if (tab === 'red_detinatori_contact' && esecuriRamase > 0) { esecuriRamase--; rez = { data: null, error: { message: 'contact picat' } } }
      else if (tab === 'red_detinatori' && unic && arr.some(a => tabele.red_detinatori.some(d => !d.sters_la && d.parcela_id === a.parcela_id && d.nume_normalizat === a.nume_normalizat))) rez = { data: null, error: { code: '23505', message: 'duplicate key' } }
      else {
        tabele[tab].push(...arr); jurnal.inserturi.push([tab, arr.length]); dupaInsert?.(tab, arr, tabele)
        if (tab === pierdeRaspuns && !pierdut) { pierdut = true; rez = { data: null, error: { message: 'TypeError: Failed to fetch' } } }
      }
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
  it('calea internă fără `permite` rămâne oprită (garda din scrie() există în continuare)', async () => {
    const { supabase, jurnal } = clientFals()
    await expect(__scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v' })).rejects.toThrow(/oprit/)
    expect(jurnal.inserturi).toEqual([])
  })
  // PR4b (17.11.2026): poarta PR3a aplicată + șablonul utilizatorului pe main + decizia proprietarului → API-ul productiv scrie.
  // Pe codul vechi (IMPORT_UTILIZATORI_ACTIV = false) acest test pică: scrieUtilizatori arunca „oprit” înainte de orice INSERT.
  it('PR4b: scrieUtilizatori (API-ul ecranului) scrie; `permite: false` trimis de apelant nu o poate opri sau porni', async () => {
    expect(IMPORT_UTILIZATORI_ACTIV).toBe(true)
    const { supabase, tabele } = clientFals()
    const r = await scrieUtilizatori(supabase, plan, { proiectId: 'pr', versiune: 'TGZ 01.01.2026 utilizatori (fictiv)', permite: false })
    expect(r).toMatchObject({ detinatoriNoi: 2, contacteNoi: 2, sarite: 0, schimbate: 0 })
    expect(tabele.red_detinatori.map(d => d.calitate)).toEqual([CALITATE_UTILIZATOR, CALITATE_UTILIZATOR])
    expect(tabele.red_import_loturi).toHaveLength(1)
    expect(tabele.red_import_loturi[0]).toMatchObject({ sursa: SURSA_UTILIZATORI, stare: 'finalizat', detinatori_noi: 2 })
  })
  it('scrie utilizatorii (calitate utilizator) + contactele, lot finalizat; cine a apărut între timp pe parcelă e sărit', async () => {
    const { supabase, tabele } = clientFals({ existentiDupaPlan: [{ id: 'd0', parcela_id: 'p2', nume_normalizat: 'B (FICTIV)', sters_la: null }] })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'TGZ 13.07.2026 utilizatori', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 1, contacteNoi: 1, sarite: 1 })
    const nou = tabele.red_detinatori.find(d => d.nume_normalizat === 'A (FICTIV)')
    expect(nou).toMatchObject({ parcela_id: 'p1', calitate: CALITATE_UTILIZATOR, versiune_lista_tgz: 'TGZ 13.07.2026 utilizatori' })
    // r2: marcajul lotului la final (dovada „scris de această operație”), lotul ține id-urile create și contactele scrise
    const lotId = tabele.red_import_loturi[0].id
    expect(nou.sursa_date).toBe(`TGZ_UTILIZATORI: TGZ Despăgubiri LOT 1 – date de contact utilizatori (col. 24–26), rândul 4; lot ${lotId}`)
    expect(tabele.red_detinatori_contact).toHaveLength(1)
    expect(tabele.red_detinatori_contact[0]).toMatchObject({ detinator_id: nou.id, adresa_cunoscuta: true, adresa_sat: 'S' })
    expect(tabele.red_import_loturi[0]).toMatchObject({ sursa: SURSA_UTILIZATORI, stare: 'finalizat', detinatori_noi: 1 })
    expect(tabele.red_import_loturi[0].diferente).toMatchObject({ scrise: [{ id: nou.id, parcela_id: 'p1', rand: 4 }], contacte_scrise: [nou.id], de_verificat_dupa_scriere: [], verificare_dupa_scriere: 'facuta' })
  })
  it('eroare la contacte → lot „esuat”, eroarea originală urcă, cu lotId; deținătorii scriși apar în lot', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 1 })
    const e = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/contact picat/)
    expect(e.lotId).toBe(tabele.red_import_loturi[0].id)
    expect(tabele.red_import_loturi[0]).toMatchObject({ stare: 'esuat', detinatori_noi: 2 })
  })
  it('r2 (Jak P1-2): reluarea după un import întrerupt completează contactele lipsă ale utilizatorilor scriși de acest import', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 1 })
    await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(() => {})
    expect(tabele.red_detinatori).toHaveLength(2); expect(tabele.red_detinatori_contact).toHaveLength(0)
    // a doua rulare: planul refăcut din BD îi vede ca „deja deținători” — contactele se repară, nimic nu se dublează
    const din = [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'B (FICTIV)' }]
    const plan2 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: din })
    expect(plan2.noi).toHaveLength(0); expect(plan2.deja_detinatori).toHaveLength(2)
    const r = await __scrieUtilizatoriTest(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 0, contacteNoi: 2 })
    expect(tabele.red_detinatori).toHaveLength(2); expect(tabele.red_detinatori_contact).toHaveLength(2)
    // a treia rulare: nimic de făcut
    expect(await __scrieUtilizatoriTest(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 0, contacteNoi: 0 })
  })
  it('r2: contactul unui proprietar existent (altă sursă) NU se atinge la reluare', async () => {
    const { supabase, tabele } = clientFals({ existentiDupaPlan: [{ id: 'd0', parcela_id: 'p1', nume_normalizat: 'A (FICTIV)', calitate: 'proprietar', sursa_date: 'TGZ', sters_la: null }] })
    const plan3 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }] })
    await __scrieUtilizatoriTest(supabase, plan3, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(tabele.red_detinatori_contact.map(c => c.detinator_id)).not.toContain('d0')
  })
  it('r2: conflict UNIQUE (alt import în paralel) → mesaj clar de reluare', async () => {
    const { supabase, tabele } = clientFals()
    tabele.red_detinatori.push({ id: 'zz', parcela_id: 'p1', nume_normalizat: 'A (FICTIV)', sters_la: null, ascuns: true })
    // rândul „ascuns” e scris de alt import după toate citirile noastre: recitirile nu-l văd, INSERT-ul lovește indexul unic
    const plan4 = { ...plan }
    const orig = supabase.from
    let citiri = 0
    supabase.from = (tab) => { const q = orig(tab); if (tab === 'red_detinatori') { const lim = q.limit; q.limit = async (k) => { citiri++; const r = await lim(k); return { ...r, data: (r.data || []).filter(d => d.id !== 'zz' && !(d.parcela_id === 'p1' && d.nume_normalizat === 'A (FICTIV)' && !d.calitate)) } } } return q }
    const e = await __scrieUtilizatoriTest(supabase, plan4, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/alt import a scris între timp/)
  })
  it('r3 (Jak r2 P1): reluarea cu un contact deja salvat — contactele (fără id) se citesc pe detinator_id, fără buclă, limită server 1', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 0, limitaServer: 1 })
    await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(tabele.red_detinatori_contact).toHaveLength(2)
    expect(tabele.red_detinatori_contact.every(c => !('id' in c))).toBe(true)
    const din = [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'B (FICTIV)' }]
    const plan2 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: din })
    expect(await __scrieUtilizatoriTest(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 0, contacteNoi: 0 })
    expect(tabele.red_detinatori_contact).toHaveLength(2)
  })
  it('r3 (Cop r2 P1-02): parcela ștearsă / HG ne-unic între plan și scriere → rândul nu se scrie, raportat', async () => {
    const parcele = [{ ...PARCELE_TEST[0], sters_la: '2026-11-05' }, PARCELE_TEST[1]]
    const { supabase, tabele } = clientFals({ parcele })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 1, schimbate: 1 })
    expect(tabele.red_detinatori.map(d => d.parcela_id)).toEqual(['p2'])
    expect(tabele.red_import_loturi[0].diferente.schimbate_la_scriere).toMatchObject([{ rand: 4 }])
    const planHg = { ...plan, noi: [{ ...plan.noi[1], potrivire: 'hg', poz_hg: '9', uat3: 'HUS' }] }
    const p2 = [PARCELE_TEST[0], { ...PARCELE_TEST[1], poz_hg: '9' }, { id: 'p9', cheie_sursa: null, id_parcela: 'X9', poz_hg: '9', sters_la: null, red_uat: { uat3: 'HUS' } }]
    const c2 = clientFals({ parcele: p2 })
    expect(await __scrieUtilizatoriTest(c2.supabase, planHg, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 0, schimbate: 1 })
  })
  it('r4 (Jak r3 P1-2): la reluare (persoana deja scrisă), două rânduri cu adrese diferite → fără contact reparat automat', () => {
    const c = [{ rand: 30, uat3: 'HUS', cheie_sursa: 'HUS|60|1|', poz_hg: '60', nume: 'J', nume_normalizat: 'J', contact: { adresa_sat: 'S1', adresa_cunoscuta: true, telefon: null } },
               { rand: 31, uat3: 'HUS', cheie_sursa: 'HUS|60|1|', poz_hg: '60', nume: 'J', nume_normalizat: 'J', contact: { adresa_sat: 'S2', adresa_cunoscuta: true, telefon: null } }]
    const p = planUtilizatori(c, { parcele: [{ id: 'p11', cheie_sursa: 'HUS|60|1|', uat3: 'HUS', poz_hg: '60' }], detinatori: [{ parcela_id: 'p11', nume_normalizat: 'J' }] })
    expect(p.noi).toEqual([]); expect(p.deja_detinatori).toHaveLength(1); expect(p.deja_detinatori[0].contact).toBeNull(); expect(p.coliziuni[0].motiv).toMatch(/adrese diferite/)
  })
  it('r4 (Jak r3 P1-1): potrivire HG — parcela aleasă a primit alt HG între plan și scriere (iar HG-ul a trecut pe altă parcelă) → nescris', async () => {
    const planHg = { ...plan, noi: [{ ...plan.noi[0], potrivire: 'hg', poz_hg: '9', uat3: 'HUS' }] }
    const parcele = [{ ...PARCELE_TEST[0], poz_hg: '10' }, { ...PARCELE_TEST[1], poz_hg: '9' }]
    const { supabase, tabele } = clientFals({ parcele })
    expect(await __scrieUtilizatoriTest(supabase, planHg, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 0, schimbate: 1 })
    expect(tabele.red_detinatori).toHaveLength(0)
  })
  it('r6 (Jak r4 P1 / Cop r4 P2-01): reluare — „deja deținător” al cărui parcelă a fost ștearsă între plan și scriere → contactul NU se repară, raportat', async () => {
    const { supabase, tabele } = clientFals({ esueazaContacte: 1 })
    await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(() => {})
    expect(tabele.red_detinatori).toHaveLength(2); expect(tabele.red_detinatori_contact).toHaveLength(0)
    const din = [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'B (FICTIV)' }]
    const plan2 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2' }], detinatori: din })
    expect(plan2.deja_detinatori.map(d => d.potrivire)).toEqual(['cheie', 'cheie'])
    tabele.red_parcele.find(p => p.id === 'p1').sters_la = '2026-11-05'   // p1 ștearsă după plan
    const r = await __scrieUtilizatoriTest(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 0, contacteNoi: 1, schimbate: 1 })
    const dP1 = tabele.red_detinatori.find(d => d.parcela_id === 'p1')
    expect(tabele.red_detinatori_contact.map(c => c.detinator_id)).not.toContain(dP1.id)
    expect(tabele.red_import_loturi.at(-1).diferente.schimbate_la_scriere).toMatchObject([{ rand: 4 }])
  })
  it('r6 (Cop r4 P2-02): potrivire pe cheie — a apărut a doua parcelă activă cu aceeași cheie între plan și scriere → nescris', async () => {
    const parcele = [...PARCELE_TEST, { id: 'p3', cheie_sursa: 'K1', id_parcela: 'X3', poz_hg: null, sters_la: null, red_uat: { uat3: 'HUS' } }]
    const { supabase, tabele } = clientFals({ parcele })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ detinatoriNoi: 1, schimbate: 1 })
    expect(tabele.red_detinatori.map(d => d.parcela_id)).toEqual(['p2'])
  })
  it('r7 (Cop r5 P2): potrivire pe cheie — parcela mutată în alt UAT între plan și scriere → nescris', async () => {
    const parcele = [{ ...PARCELE_TEST[0], red_uat: { uat3: 'BAL' } }, PARCELE_TEST[1]]
    const { supabase, tabele } = clientFals({ parcele })
    expect(await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })).toMatchObject({ detinatoriNoi: 1, schimbate: 1 })
    expect(tabele.red_detinatori.map(d => d.parcela_id)).toEqual(['p2'])
  })
  it('r3 (Cop r2 P2-01): aceeași persoană pe aceeași parcelă cu adrese diferite → ambele rânduri excluse, raportate', () => {
    const c = [{ rand: 20, uat3: 'HUS', cheie_sursa: 'HUS|50|1|', poz_hg: '50', nume: 'H', nume_normalizat: 'H', contact: { adresa_sat: 'S1', adresa_cunoscuta: true, telefon: null } },
               { rand: 21, uat3: 'HUS', cheie_sursa: 'HUS|50|1|', poz_hg: '50', nume: 'H', nume_normalizat: 'H', contact: { adresa_sat: 'S2', adresa_cunoscuta: true, telefon: null } }]
    const p = planUtilizatori(c, { parcele: [{ id: 'p10', cheie_sursa: 'HUS|50|1|', uat3: 'HUS', poz_hg: '50' }] })
    expect(p.noi).toEqual([]); expect(p.coliziuni[0].motiv).toMatch(/adrese diferite/)
  })
  it('r2 (Jak P2-4): citirea keyset nu se oprește la o limită de server mai mică decât pagina', async () => {
    const { supabase, tabele } = clientFals({ limitaServer: 1 })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true, pagina: 1000 })
    expect(r.detinatoriNoi).toBe(2); expect(tabele.red_detinatori_contact).toHaveLength(2)
  })
  // ── r2 (Jak PR1120 P1 / P2) ──
  it('r2 pct. 1a: ținta se recitește înaintea FIECĂREI bucăți — o a doua parcelă cu aceeași cheie apărută după prima bucată oprește a doua', async () => {
    // pe 4f98f4a0 recitirea era o dată pentru tot lotul: rândul 5 se scria pe ținta veche
    const { supabase, tabele } = clientFals({ dupaInsert: (tab, arr, t) => { if (tab === 'red_detinatori' && arr.some(a => a.parcela_id === 'p1')) t.red_parcele.push({ id: 'p9', cheie_sursa: 'K2', id_parcela: 'X9', poz_hg: null, sters_la: null, red_uat: { uat3: 'HUS' } }) } })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true, marimeLot: 1 })
    expect(r).toMatchObject({ detinatoriNoi: 1, schimbate: 1, deVerificat: [] })
    expect(tabele.red_detinatori.map(d => d.parcela_id)).toEqual(['p1'])
    expect(tabele.red_import_loturi[0].diferente.schimbate_la_scriere).toMatchObject([{ rand: 5, motiv: expect.stringMatching(/cheia nu mai e unică/) }])
  })
  it('r2 pct. 1b: verificarea după scriere — ținta schimbată după INSERT (fereastra rămasă) → „de verificat”, în rezultat și în lot', async () => {
    const { supabase, tabele } = clientFals({ dupaInsert: (tab, arr, t) => { if (tab === 'red_detinatori') t.red_parcele.find(p => p.id === 'p2').sters_la = '2026-11-17' } })
    const r = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r.detinatoriNoi).toBe(2)
    const dP2 = tabele.red_detinatori.find(d => d.parcela_id === 'p2')
    expect(r.deVerificat).toEqual([{ rand: 5, id: dP2.id, parcela_id: 'p2', id_parcela: 'X2', motiv: 'de verificat: ținta s-a schimbat în timpul importului (parcela nu mai e activă în proiect)' }])
    expect(tabele.red_import_loturi[0].diferente.de_verificat_dupa_scriere).toEqual(r.deVerificat)
  })
  it('r2 pct. 3: INSERT comis, răspuns pierdut → eroarea urcă, dar lotul are evidența din BD (id-uri, contor) și e „esuat”', async () => {
    const { supabase, tabele } = clientFals({ pierdeRaspuns: 'red_detinatori' })
    const e = await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true }).catch(x => x)
    expect(e.message).toMatch(/Failed to fetch/); expect(e.code).toBeUndefined()
    expect(tabele.red_detinatori).toHaveLength(2)                        // comise
    const lot = tabele.red_import_loturi[0]
    expect(lot).toMatchObject({ stare: 'esuat', detinatori_noi: 2 })     // pe 4f98f4a0: 0
    expect(lot.diferente.evidenta_din_bd).toBe(true)
    expect(lot.diferente.scrise.map(s => s.id).sort()).toEqual(tabele.red_detinatori.map(d => d.id).sort())
  })
  it('r2 pct. 8: 0 noi și niciun contact de completat → niciun lot nou', async () => {
    const { supabase, tabele } = clientFals()
    await __scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: 'v', permite: true })
    const din = [{ parcela_id: 'p1', nume_normalizat: 'A (FICTIV)' }, { parcela_id: 'p2', nume_normalizat: 'B (FICTIV)' }]
    const plan2 = planUtilizatori(plan.noi.map(({ parcela_id, id_parcela, potrivire, ...c }) => c), { parcele: [{ id: 'p1', cheie_sursa: 'K1', id_parcela: 'X1', uat3: 'HUS' }, { id: 'p2', cheie_sursa: 'K2', id_parcela: 'X2', uat3: 'HUS' }], detinatori: din })
    const r = await __scrieUtilizatoriTest(supabase, plan2, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(r).toMatchObject({ lotId: null, nimicDeFacut: true, detinatoriNoi: 0, contacteNoi: 0 })
    expect(tabele.red_import_loturi).toHaveLength(1)                       // pe 4f98f4a0: 2
  })
  it('r2 pct. 5: potrivirile HG neconfirmate (scoase de ecran din plan.noi) ajung în lot ca hg_neconfirmate, fără nume / contact', async () => {
    const { supabase, tabele } = clientFals()
    const hg = { rand: 9, uat3: 'HUS', cheie_sursa: 'HUS|9|X|', poz_hg: '9', nume: 'Z (fictiv)', nume_normalizat: 'Z (FICTIV)', contact: { adresa_cunoscuta: true }, parcela_id: 'p2', id_parcela: 'X2', potrivire: 'hg' }
    await __scrieUtilizatoriTest(supabase, { ...plan, hg_neconfirmate: [hg] }, { proiectId: 'pr', versiune: 'v', permite: true })
    expect(tabele.red_import_loturi[0].diferente.hg_neconfirmate).toEqual([{ rand: 9, uat3: 'HUS', cheie_sursa: 'HUS|9|X|', poz_hg: '9', parcela_id: 'p2', id_parcela: 'X2', potrivire: 'hg' }])
    expect(tabele.red_detinatori.some(d => d.nume_normalizat === 'Z (FICTIV)')).toBe(false)
  })
  it('fără proiect / versiune → refuz înainte de orice scriere', async () => {
    const { supabase, jurnal } = clientFals()
    await expect(__scrieUtilizatoriTest(supabase, plan, { versiune: 'v', permite: true })).rejects.toThrow(/proiectId/)
    await expect(__scrieUtilizatoriTest(supabase, plan, { proiectId: 'pr', versiune: ' ', permite: true })).rejects.toThrow(/versiunea/)
    expect(jurnal.inserturi).toEqual([])
  })
})
