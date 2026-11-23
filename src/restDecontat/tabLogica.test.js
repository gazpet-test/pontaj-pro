// Teste pentru logica tab-ului „💰 Rest de decontat” (Task 5) și exportul Excel. Date FALSE (coduri și sume inventate), așteptări scrise de mână
// (L25). Coloanele folosite de tab / export se compară cu textul vederilor din migrarea 20270105a (L19).
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as XLSX_mod from 'xlsx-js-style'
import {
  totaluriProiect, semnalRisc, filtreazaArticole, grupePeObiect, grupeazaLipsuri, totalAjustari, etichetaLipsa, ETICHETE_LIPSURI,
  PRAG_PROIECT_AVANSAT_PCT, PRAG_ARTICOL_SUB_PCT,
} from './tabLogica.js'
import { construiesteExportRest, numeFisierRest, CAP_ARTICOLE } from './restDecontatExport.js'
import { A, ARTICOLE, OBIECTE } from './restDecontat.testutil.jsx'
const XLSX = XLSX_mod.default || XLSX_mod

const MIG = fs.readFileSync(new URL('../../supabase/migrations/20270105a_executie_rest_decontat.sql', import.meta.url), 'utf8').replace(/\r/g, '')


describe('paritate cu vederile din 20270105a', () => {
  const coloane = fn => { const m = MIG.match(new RegExp(`CREATE FUNCTION public\\.${fn}\\(\\)\\s+RETURNS TABLE \\(([\\s\\S]*?)\\)\\s+LANGUAGE`)); return [...m[1].matchAll(/([a-z_]+) (?:bigint|text|numeric|boolean|integer)/g)].map(x => x[1]) }
  it('rândurile false au exact coloanele vederilor (articole / obiecte)', () => {
    expect(Object.keys(ARTICOLE[0]).sort()).toEqual(coloane('fn_rest_decontat_calcul').sort())
    expect(Object.keys(OBIECTE[0]).sort()).toEqual(coloane('fn_rest_decontat_obiect_calcul').sort())
  })
  it('toate tipurile de lipsuri din vederea de lipsuri au etichetă', () => {
    const corp = MIG.slice(MIG.indexOf('CREATE FUNCTION public.fn_rest_decontat_lipsuri_calcul'), MIG.indexOf('REVOKE ALL ON FUNCTION public.fn_rest_decontat_lipsuri_calcul'))
    const tipuri = [...new Set([...corp.matchAll(/SELECT pr\.id, '([a-z_]+)'/g)].map(m => m[1]))]
    expect(tipuri.length).toBeGreaterThanOrEqual(10)
    expect(tipuri.filter(t => !ETICHETE_LIPSURI[t])).toEqual([])
  })
})

describe('totaluri, filtre, semnal, grupare', () => {
  it('totalul pe proiect = suma obiectelor (coerent); o diferență se semnalează', () => {
    const t = totaluriProiect(OBIECTE)
    expect(t).toMatchObject({ baza: 5000, decontat: 2080, rest: 2920, pct: 41.6, coerent: true })
    expect(t.sumaObiecte).toEqual({ baza: 5000, decontat: 2080, rest: 2920 })
    const strica = OBIECTE.map(o => (o.nivel === 'proiect' ? { ...o, decontat_valoare: 2000 } : o))
    expect(totaluriProiect(strica).coerent).toBe(false)
    expect(totaluriProiect([])).toMatchObject({ baza: null, coerent: true })
  })
  it('„peste ofertă” lasă doar rândurile cu rest negativ (inclusiv articolul nou)', () => {
    const r = filtreazaArticole(ARTICOLE, { peste: true })
    expect(r.map(a => a.cod)).toEqual(['C2', 'NOU'])
    expect(r.every(a => a.rest_valoare < 0)).toBe(true)
  })
  it('„doar cu rest” = rest în bani > 0; „nedecontat deloc”; obiect; text', () => {
    expect(filtreazaArticole(ARTICOLE, { doarCuRest: true }).map(a => a.cod)).toEqual(['C1', 'C3', 'C4'])
    expect(filtreazaArticole(ARTICOLE, { nedecontat: true }).map(a => a.cod)).toEqual(['C3'])
    expect(filtreazaArticole(ARTICOLE, { obiect: '0001' }).map(a => a.cod)).toEqual(['C1', 'C2'])
    expect(filtreazaArticole(ARTICOLE, { text: 'lucrare c4' }).map(a => a.cod)).toEqual(['C4'])
  })
  it(`semnalul de risc: doar de la ${PRAG_PROIECT_AVANSAT_PCT}% decontat pe proiect; nedecontat sau sub ${PRAG_ARTICOL_SUB_PCT}%; sortat după rest`, () => {
    expect(semnalRisc(ARTICOLE, 69.9)).toEqual([])
    expect(semnalRisc(ARTICOLE, null)).toEqual([])
    expect(semnalRisc(ARTICOLE, 70).map(a => a.cod)).toEqual(['C4', 'C3'])      // C4 15% (rest 1700), C3 nedecontat (rest 1000); articolul nou nu
    expect(semnalRisc([A('0001|D1|X', { pct_decontat: 20 })], 90)).toEqual([])  // exact pragul = nu e sub
  })
  it('gruparea pe obiect: articolele din bază întâi, articolul nou la finalul obiectului; banii obiectului din vedere', () => {
    const g = grupePeObiect(ARTICOLE, OBIECTE)
    expect(g.map(x => x.obiect_cod)).toEqual(['0001', '0002'])
    expect(g[1].articole.map(a => a.cod)).toEqual(['C3', 'C4', 'NOU'])
    expect(g[1].obiect.rest_valoare).toBe(2620)
  })
  it('lipsurile pe tip; un tip necunoscut rămâne vizibil cu numele lui', () => {
    const g = grupeazaLipsuri([{ tip: 'sl_fara_detaliu', referinta: 'SL 2' }, { tip: 'tip_nou', referinta: 'x' }, { tip: 'fara_oferta', referinta: 'proiect 1' }, { tip: 'sl_fara_detaliu', referinta: 'SL 3' }])
    expect(g.map(x => [x.tip, x.referinte.length])).toEqual([['fara_oferta', 1], ['sl_fara_detaliu', 2], ['tip_nou', 1]])
    expect(etichetaLipsa('tip_nou')).toBe('tip_nou')
  })
  it('ajustările de preț: suma din situațiile de plată (null = 0)', () => {
    expect(totalAjustari([{ valoare_ajustare_lei: 12.5 }, { valoare_ajustare_lei: null }, { valoare_ajustare_lei: '7.25' }])).toBe(19.75)
  })
})

describe('exportul Excel', () => {
  it('foile, antetul și rândurile (articole ordonate, total proiect la final pe obiecte)', () => {
    const bytes = construiesteExportRest({ articole: ARTICOLE, obiecte: OBIECTE, lipsuri: [{ tip: 'sl_fara_detaliu', referinta: 'SL 2' }], ajustari: 19.75, proiect: { cod_intern: 'T1' }, generatLa: 'acum' })
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Pe articol', 'Pe obiect', 'Lipsuri', 'Despre'])
    const art = XLSX.utils.sheet_to_json(wb.Sheets['Pe articol'], { header: 1 })
    expect(art[0]).toEqual(CAP_ARTICOLE)
    expect(art.slice(1).map(r => r[3])).toEqual(['C1', 'C2', 'C3', 'C4', 'NOU'])
    expect(art[2][13]).toBe(-200)                     // rest valoare C2, negativ (nu tăiat la zero)
    expect(art[5][6]).toMatch(/în afara ofertei/)
    const ob = XLSX.utils.sheet_to_json(wb.Sheets['Pe obiect'], { header: 1 })
    expect(ob.at(-1).slice(0, 6)).toEqual(['TOTAL PROIECT', '', '', 5000, 2080, 2920])
    const lp = XLSX.utils.sheet_to_json(wb.Sheets.Lipsuri, { header: 1 })
    expect(lp[1]).toEqual(['Situație de plată fără detaliu pe articole', 'SL 2'])
    expect(numeFisierRest('T 1/x', '2026-11-23')).toBe('Rest_de_decontat_T_1_x_23.11.2026.xlsx')
  })
})
