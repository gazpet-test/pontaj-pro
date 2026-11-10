import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import * as XLSX_mod from 'xlsx-js-style'
import {
  AMPRENTA_GOL, cantitateLinie, blocNou, blocuriDinLinii, liniiDinBlocuri, tintaPe, activitatiBloc, ordoneaza, metadateTinte, propunePotrivire,
} from './devizTinte.js'
import { construiesteExportTinte, randuriExport, CAP_EXPORT, numeFisierTinte } from './devizTinteExport.js'
import { EXECUTATE } from './nodCuplareLogica.js'
const XLSX = XLSX_mod.default || XLSX_mod

const MIG = fs.readFileSync(new URL('../supabase/migrations/20261208a_executie_devize_tinte.sql', import.meta.url), 'utf8').replace(/\r/g, '')

describe('paritate cu migrarea 20261208a', () => {
  it('amprenta setului gol = md5 de șirul gol (ca fn_raport_lucrari_amprenta_linii pe [])', () => {
    expect(AMPRENTA_GOL).toBe(createHash('md5').update('').digest('hex'))
    expect(MIG).toContain("coalesce(p, '[]'::jsonb)")
  })
  it('„sudată” în schema nodului = aceeași listă ca EXECUTATE din nodCuplareLogica', () => {
    const bloc = MIG.match(/-- EXECUTATE-START\n([\s\S]*?)-- EXECUTATE-END/)
    expect(bloc).not.toBeNull()
    const stari = [...bloc[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(stari).toEqual(EXECUTATE)
  })
  it('conversia UM: aceeași listă albă pentru UM-ul articolului și al activității (HM = 100 m, 100 MC = 100 mc)', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_executie_tinte_conversie'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_executie_tinte_conversie'))
    const t = [...corp.matchAll(/\('([0-9A-Z]+)', (\d+), '([A-Z]+)'\)/g)].map(m => m.slice(1).join(':'))
    expect(t.length).toBeGreaterThan(10)
    expect(t.slice(0, t.length / 2)).toEqual(t.slice(t.length / 2))
    expect(t).toContain('HM:100:M')
    expect(t).toContain('100MC:100:MC')
  })
  it('limitele cantității sunt aceleași ca în RPC (> 0, ≤ 10.000.000, 3 zecimale)', () => {
    expect(MIG).toContain('v_cant <= 0 OR v_cant > 10000000 OR v_cant <> round(v_cant, 3)')
    expect(MIG).toContain('jsonb_array_length(p_linii) > 500')
  })
})

describe('cantitateLinie', () => {
  it('gol și 0 = nimic de salvat; numere RO și EN', () => {
    expect(cantitateLinie('')).toEqual({ gol: true })
    expect(cantitateLinie(null)).toEqual({ gol: true })
    expect(cantitateLinie('0')).toEqual({ gol: true })
    expect(cantitateLinie('12,5')).toEqual({ valoare: 12.5 })
    expect(cantitateLinie('12.5')).toEqual({ valoare: 12.5 })
    expect(cantitateLinie(3)).toEqual({ valoare: 3 })
    expect(cantitateLinie('1.234,5')).toEqual({ valoare: 1234.5 })
  })
  it('refuză ce ar refuza serverul (text, negativ, 4 zecimale, prea mare)', () => {
    expect(cantitateLinie('abc').eroare).toBeTruthy()
    expect(cantitateLinie('-2').eroare).toMatch(/negativ/)
    expect(cantitateLinie('1,2345').eroare).toMatch(/3 zecimale/)
    expect(cantitateLinie('1.234').valoare).toBe(1.234)
    expect(cantitateLinie('10000001').eroare).toMatch(/10\.000\.000/)
  })
})

const ACT = [
  { id: 1, nume: 'Țeavă lansată', principala: true, tip_raportare: 'cantitate', sursa_executat: 'raport' },
  { id: 2, nume: 'Suduri DN600', principala: true, tip_raportare: 'cantitate', sursa_executat: 'schema_nod' },
  { id: 3, nume: 'Probă', principala: true, tip_raportare: 'bifa', sursa_executat: 'raport' },
  { id: 4, nume: 'Diverse', principala: false, tip_raportare: 'cantitate', sursa_executat: 'raport' },
]
const UN = [{ id: 10, cod: 'T1', nume: 'Tronson 1' }, { id: 20, cod: 'NOD', nume: 'Cuplare', nod_cod: 'NOD-CUPLARE-X' }]

describe('blocurile raportului (mai multe obiecte)', () => {
  it('liniile salvate se grupează pe obiect, în ordinea primei apariții', () => {
    const b = blocuriDinLinii([{ activitate_id: 1, unitate_id: 10, cantitate: 120.5 }, { activitate_id: 1, unitate_id: null, cantitate: 7 },
      { activitate_id: 3, unitate_id: 10, cantitate: 1 }])
    expect(b.map(x => x.unitateId)).toEqual([10, null])
    expect(b[0].valori).toEqual({ 1: 120.5, 3: 1 })
    expect(b[1].valori).toEqual({ 1: 7 })
  })
  it('blocuri -> linii, cu aceleași reguli ca RPC-ul', () => {
    const b1 = { ...blocNou(10), valori: { 1: '120,5', 2: '4', 3: 1, 4: '' } }
    const b2 = { ...blocNou(null), valori: { 1: '7' } }
    const r = liniiDinBlocuri([b1, b2], { activitati: ACT, unitati: UN })
    expect(r.erori).toEqual([])
    expect(r.linii).toEqual([
      { activitate_id: 1, unitate_id: 10, cantitate: 120.5 }, { activitate_id: 2, unitate_id: 10, cantitate: 4 },
      { activitate_id: 3, unitate_id: 10, cantitate: 1 }, { activitate_id: 1, unitate_id: null, cantitate: 7 }])
  })
  it('la nod, sudurile din schemă nu se raportează; bifa = 1; obiectul o singură dată; necunoscutele = eroare', () => {
    expect(liniiDinBlocuri([{ ...blocNou(20), valori: { 2: '3' } }], { activitati: ACT, unitati: UN }).erori[0]).toMatch(/schema nodului/)
    expect(liniiDinBlocuri([{ ...blocNou(10), valori: { 3: '2' } }], { activitati: ACT, unitati: UN }).erori[0]).toMatch(/bifează/)
    expect(liniiDinBlocuri([{ ...blocNou(10), valori: { 1: '1' } }, { ...blocNou(10), valori: { 1: '2' } }], { activitati: ACT, unitati: UN }).erori[0]).toMatch(/de două ori/)
    expect(liniiDinBlocuri([{ ...blocNou(99), valori: { 1: '1' } }], { activitati: ACT, unitati: UN }).erori[0]).toMatch(/necunoscut/)
    expect(liniiDinBlocuri([{ ...blocNou(10), valori: { 77: '1' } }], { activitati: ACT, unitati: UN }).erori[0]).toMatch(/activitate necunoscută/)
    const r = liniiDinBlocuri([{ ...blocNou(10), valori: { 1: 'x', 4: '2' } }], { activitati: ACT, unitati: UN })
    expect(r.erori).toHaveLength(1)
    expect(r.linii).toEqual([{ activitate_id: 4, unitate_id: 10, cantitate: 2 }])
  })
})

describe('activitățile arătate într-un bloc', () => {
  const tinte = [{ unitate_id: 10, activitate_id: 1, din_deviz: 1300 }, { unitate_id: 10, activitate_id: 3, din_deviz: 1 },
    { unitate_id: 20, activitate_id: 2, din_deviz: 20 }, { unitate_id: 10, activitate_id: 2, din_deviz: 0 }]
  it('doar principalele cu țintă pe obiect (+ ce are deja valoare)', () => {
    expect(activitatiBloc({ activitati: ACT, tinte, unitateId: 10 }).map(a => a.id)).toEqual([1, 3])
    expect(activitatiBloc({ activitati: ACT, tinte, unitateId: 20 }).map(a => a.id)).toEqual([2])
    expect(activitatiBloc({ activitati: ACT, tinte, unitateId: 10, valori: { 4: 2 } }).map(a => a.id)).toEqual([1, 3, 4])
    expect(activitatiBloc({ activitati: ACT, tinte, unitateId: null }).map(a => a.id)).toEqual([])
  })
  it('„toate activitățile” sau proiect fără principale = toate', () => {
    expect(activitatiBloc({ activitati: ACT, tinte, unitateId: 10, toate: true })).toHaveLength(4)
    const fara = ACT.map(a => ({ ...a, principala: false }))
    expect(activitatiBloc({ activitati: fara, tinte: [], unitateId: null })).toHaveLength(4)
  })
  it('tintaPe distinge „fără obiect” (null) de obiecte', () => {
    const t = [{ unitate_id: null, activitate_id: 1, executat: 7 }, { unitate_id: 10, activitate_id: 1, executat: 9 }]
    expect(tintaPe(t, null, 1).executat).toBe(7)
    expect(tintaPe(t, '10', 1).executat).toBe(9)
    expect(tintaPe(t, 10, 2)).toBeNull()
  })
})

describe('ordinea și metadatele', () => {
  const r = (u, uo, a, ao) => ({ proiect_id: 1, unitate_id: u, unitate_ordine: uo, activitate_id: a, activitate_ordine: ao, prag_in_urma_pp: 15, zile_fara_raport: 7, calculat_la: '2026-11-10' })
  it('obiectele în ordine, „fără obiect” și „nealocat” la final', () => {
    const s = ordoneaza([r(null, null, 1, 1), r(20, 2, null, null), r(20, 2, 1, 1), r(10, 1, 3, 3), r(10, 1, 1, 1)])
    expect(s.map(x => `${x.unitate_id}:${x.activitate_id}`)).toEqual(['10:1', '10:3', '20:1', '20:null', 'null:1'])
  })
  it('pragurile exportului vin din rânduri și trebuie să fie aceleași', () => {
    expect(metadateTinte([r(10, 1, 1, 1)])).toEqual({ proiect_id: 1, prag_in_urma_pp: 15, zile_fara_raport: 7, calculat_la: '2026-11-10' })
    expect(() => metadateTinte([r(10, 1, 1, 1), { ...r(10, 1, 3, 3), prag_in_urma_pp: 10 }])).toThrow(/reîncearcă/)
    expect(() => metadateTinte([])).toThrow(/nimic/)
  })
})

describe('potrivirea propusă obiect din deviz ↔ unitate', () => {
  const obiecte = [{ obiect_cod: '0001', obiect_nume: 'TRONSON 1' }, { obiect_cod: '0002', obiect_nume: 'TRONSON 2' },
    { obiect_cod: '0012', obiect_nume: 'CUPLARE PRUNISOR' }, { obiect_cod: '0013', obiect_nume: 'Statie de Robinete' },
    { obiect_cod: '0019', obiect_nume: 'Organizare de Santier' }]
  it('T<n> ↔ TRONSON n, nodul ↔ cuplarea, numele identic (fără diacritice)', () => {
    const u = [{ id: 1, cod: 'T1', nume: 'Tronson 1 — km 0…2' }, { id: 2, cod: null, nume: 'Tronson 2' }, { id: 3, cod: 'NOD', nume: 'Nod Prunișor', nod_cod: 'NOD-CUPLARE-PRUNISOR' },
      { id: 4, cod: null, nume: 'Stație de robinete' }]
    expect(propunePotrivire(u, obiecte)).toEqual([
      { unitate_id: 1, obiect_cod: '0001', motiv: 'tronsonul 1' }, { unitate_id: 2, obiect_cod: '0002', motiv: 'tronsonul 2' },
      { unitate_id: 3, obiect_cod: '0012', motiv: 'nodul de cuplare' }, { unitate_id: 4, obiect_cod: '0013', motiv: 'același nume' }])
  })
  it('ce e ambiguu sau deja legat nu se propune', () => {
    const u = [{ id: 1, cod: 'T1', nume: 'x' }, { id: 2, cod: 'TR1', nume: 'y' }, { id: 3, cod: 'T2', nume: 'z', obiect_cod: '0002' }]
    expect(propunePotrivire(u, obiecte)).toEqual([])
    expect(propunePotrivire([{ id: 5, cod: 'T2', nume: 'Tronson 2' }, { id: 6, cod: 'T9', nume: 'w', obiect_cod: '0002' }], obiecte)).toEqual([])
  })
})

describe('exportul Excel', () => {
  const baza = { proiect_id: 1, prag_in_urma_pp: 10, zile_fara_raport: null, calculat_la: '2026-11-10' }
  const tinte = [
    { ...baza, unitate_id: 10, unitate_cod: 'T1', unitate_nume: 'Tronson 1', unitate_ordine: 1, obiect_cod: '0001', activitate_id: 1, activitate_nume: 'Țeavă lansată',
      activitate_ordine: 1, um: 'm', principala: true, baza_deviz: 'revizuita', factor_um: 100, articole: 3, din_deviz: 1300, executat: 1420.5,
      executat_sursa: 'raport', rest: 0, peste_deviz: 120.5, pct_executat: 109.3, pct_plan: 100, plan_start: '2026-08-03', plan_final: '2026-11-10',
      ultima_raportare: '2026-11-08', alerte: ['peste_deviz'] },
    { ...baza, unitate_id: null, activitate_id: 1, activitate_nume: 'Țeavă lansată', activitate_ordine: 1, um: 'm', principala: true, baza_deviz: 'revizuita',
      factor_um: 100, articole: 0, din_deviz: null, executat: 7, executat_sursa: 'raport', alerte: ['fara_obiect'] },
  ]
  it('rândurile, în ordine, cu valorile din vedere', () => {
    const r = randuriExport(tinte)
    expect(r[0].slice(0, 4)).toEqual(['T1 · Tronson 1', '0001', '', 'Țeavă lansată'])
    expect(r[0][CAP_EXPORT.indexOf('Peste deviz')]).toBe(120.5)
    expect(r[0][CAP_EXPORT.indexOf('Plan start')]).toBe('03.08.2026')
    expect(r[0][CAP_EXPORT.indexOf('Alerte')]).toBe('Peste deviz')
    expect(r[1][0]).toBe('— fără obiect —')
    expect(r[1][CAP_EXPORT.indexOf('Din deviz')]).toBe('')
  })
  it('fișierul se citește înapoi; „Despre” are pragurile rândurilor', () => {
    const wb = XLSX.read(construiesteExportTinte({ tinte, proiect: { cod_intern: 'LOT-T', nume: 'test' }, generatLa: '10.11.2026 12:00' }), { type: 'array' })
    expect(wb.SheetNames).toEqual(['Deviz vs executat', 'Despre'])
    const d = XLSX.utils.sheet_to_json(wb.Sheets['Deviz vs executat'], { header: 1, defval: '' })
    expect(d[0]).toEqual(CAP_EXPORT)
    expect(d).toHaveLength(3)
    const i = XLSX.utils.sheet_to_json(wb.Sheets.Despre, { header: 1, defval: '' })
    expect(i.find(x => x[0] === 'Prag „în urmă”')[1]).toMatch(/^10 puncte/)
    expect(i.find(x => x[0] === 'Prag „fără raport”')[1]).toBe('oprit')
    expect(numeFisierTinte('LOT 1/x', '2026-11-10')).toBe('Deviz_vs_executat_LOT_1_x_10.11.2026.xlsx')
  })
})
