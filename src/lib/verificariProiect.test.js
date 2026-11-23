// Teste pentru verificariProiect.js — stadiul fizic (Rest de decontat PR1 r8, review #1158 P1: cititorii plafonați la 1000 de rânduri). stadiuFizic
// adună cantitățile articolelor pe prefixe și raportările pe activitate; PostgREST dă cel mult 1000 de rânduri pe cerere, iar citirea veche (fără ordine,
// fără paginare) primea un SUBSET dependent de ordinea fizică → procentul se schimba după confirmarea ofertei în „Rest de decontat” (rândurile confirmate
// scrise la sfârșitul tabelului) pe proiectele cu peste 1000 de articole. Aici: 1.001 articole în două ordini fizice → același procent, egal cu cel calculat
// din date (L25); 1.001 raportări → complet; eroarea de citire se propagă (L18), nu devine „stadiu necunoscut”. Client Supabase FALS cu plafonul max-rows.
import { afterEach, describe, it, expect, vi } from 'vitest'

const st = vi.hoisted(() => ({ tabele: {}, cereri: [], erori: {} }))
vi.mock('./supabase.js', async () => {
  const { creeazaClientFals } = await import('./supabaseFalsPlafon.js')
  return { supabase: creeazaClientFals(st) }
})
import { verificaProiect } from './verificariProiect.js'

const PID = 7
const PROIECT = { id: PID, nume: 'Proiect test', data_start: '2026-01-01', data_termen: '2026-12-31', contract_id: null, mp_employee_id: 1, rte_employee_id: 1, rts_employee_id: 1,
  coordonator_transgaz: 'x', nr_contract: '1', data_contract: '2025-12-01', valoare_lei: 1, garantie_buna_exec_pct: 10, penalitati_zi_pct: 0.1, doc_ordin_incepere_path: 'x',
  doc_caiet_sarcini_path: 'x', doc_itp_pccvi_path: 'x' }
const ACTIVITATI = [{ id: 1, proiect_id: PID, coduri_deviz: 'TSA', activ: true }]
// 1.001 articole: 101 TSA × 20 (contract 2.020), 900 GC × 2; „înainte” TSA primele, „după” TSA la sfârșit cu id-uri noi
const ARTICOLE = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, proiect_id: PID, cod: i < 101 ? 'TSA01A1' : 'GC 01', cantitate: i < 101 ? 20 : 2, sursa: 'contract_initial' }))
const ARTICOLE_DUPA = [...ARTICOLE.filter(a => a.cod !== 'TSA01A1'), ...ARTICOLE.filter(a => a.cod === 'TSA01A1').map((a, i) => ({ ...a, id: 5000 + i }))]
// 1.001 raportări × 1 pe activitatea 1
const RAPORTARI = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, proiect_id: PID, activitate_id: 1, cantitate: 1 }))
// așteptatul, din date: realizat / contract × 100, plafonat la 100
const CONTRACT = ARTICOLE.filter(a => a.cod.toUpperCase().startsWith('TSA')).reduce((s, a) => s + a.cantitate, 0)
const REALIZAT = RAPORTARI.reduce((s, r) => s + r.cantitate, 0)
const PCT_ASTEPTAT = Math.min(100, REALIZAT / CONTRACT * 100)

afterEach(() => { st.cereri = []; st.tabele = {}; st.erori = {} })
const pregateste = articole => { st.tabele = { executie_proiecte: [PROIECT], proiect_activitati: ACTIVITATI, proiect_articole: articole, raport_lucrari: RAPORTARI } }

describe('stadiuFizic pe proiecte cu peste 1000 de rânduri (citire completă, pe chei)', () => {
  it('plafonul fals: cititorul VECHI ar vedea alt contract după confirmare (condiția review-ului e reprodusă)', async () => {
    const { creeazaClientFals, MAX_ROWS } = await import('./supabaseFalsPlafon.js')
    const vechi = async articole => {
      const { data } = await creeazaClientFals({ tabele: { proiect_articole: articole }, cereri: [], erori: {} }).from('proiect_articole').select('cod, cantitate, sursa').eq('proiect_id', PID).neq('sursa', 'extras_materiale')
      return { n: data.length, q: data.filter(x => x.cod.toUpperCase().startsWith('TSA')).reduce((s, x) => s + x.cantitate, 0) }
    }
    const a = await vechi(ARTICOLE), b = await vechi(ARTICOLE_DUPA)
    expect([a.n, b.n]).toEqual([MAX_ROWS, MAX_ROWS])
    expect(a.q).toBe(CONTRACT)
    expect(b.q).toBeLessThan(CONTRACT)
  })
  it('înainte: procentul = realizat / contractul TUTUROR articolelor TSA (1.001 rânduri, 1.001 raportări)', async () => {
    pregateste(ARTICOLE)
    const v = await verificaProiect(PID)
    expect(v.stadiu).toMatchObject({ activitatiMasurate: 1, activitatiTotal: 1 })
    expect(v.stadiu.pct).toBeCloseTo(PCT_ASTEPTAT, 9)
    for (const t of ['proiect_articole', 'raport_lucrari']) {
      const c = st.cereri.filter(x => x.tabel === t && x.op === 'select')
      expect(c.length, t).toBeGreaterThanOrEqual(2)
      expect(c.every(x => x.ordine.includes('id') && x.limita != null), t).toBe(true)
    }
  })
  it('după confirmare (TSA rescrise la sfârșit, id-uri noi): EXACT același procent', async () => {
    pregateste(ARTICOLE_DUPA)
    const v = await verificaProiect(PID)
    expect(v.stadiu.pct).toBeCloseTo(PCT_ASTEPTAT, 9)
  })
  it('eroare la citirea articolelor: se propagă (nu „stadiu necunoscut” tăcut)', async () => {
    pregateste(ARTICOLE)
    st.erori = { proiect_articole: { message: 'permission denied for table proiect_articole', code: '42501' } }
    await expect(verificaProiect(PID)).rejects.toMatchObject({ message: 'permission denied for table proiect_articole' })
  })
  it('fără activități: stadiu null (nu eroare), ca înainte', async () => {
    pregateste(ARTICOLE)
    st.tabele.proiect_activitati = []
    const v = await verificaProiect(PID)
    expect(v.stadiu).toBeNull()
  })
})
