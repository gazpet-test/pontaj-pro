import { describe, it, expect } from 'vitest'
import { obiecteDinCsv, perioadeDinGrafic, kmTronsoane, propuneUnitati, genereazaSql } from './lot1_potrivire_sql.mjs'

// date SINTETICE, în formatul dosarului (CSV cu „;”, tabele Markdown)
const CSV = String.fromCharCode(0xFEFF) + [
  'obiect;deviz;denumire_deviz;nr_art;cod_articol;denumire_articol;UM;cant_ofertata',
  '0001 TRONSON 1;D1;x;001;GA04J1;lansare;HM.;19.47',
  '0001 TRONSON 1;D1;x;002;TSC04B1;sapatura;100 MC.;12',
  '0002 TRONSON 2;D2;x;001;GA04J1;lansare;HM.;30',
  '0012 CUPLARE TEST;D12;x;001;M1L05I1;radiografie;BUC.;30',
  '0013 Statie de Robinete;D13;x;001;X;y;BUC.;1',
  '0019 Organizare de Santier;D19;x;001;X;y;BUC.;1',
  '0025 NCS - Lucrari suplimentare;D25;x;001;X;y;BUC.;1',
  'F4 Utilaje;F4;x;001;X;y;BUC.;1',
].join('\r\n')
const GRAFIC = [
  '# grafic', '', '**Durate pe obiecte în graficul de referință** (start → final):', '',
  '| Obiect | Start | Final | Valoare ofertă (lei) |', '|---|---|---|---:|',
  '| Organizare de șantier, drumuri acces | 12.05.2025 | 18.12.2026 | 1 |',
  '| T1 km 0–2 | 07.09.2026 | 11.12.2026 | 1 |',
  '| T2 km 2–5 | 29.06.2026 | 19.11.2026 | 1 |',
  '| Cuplare Test | 04.05.2026 | 16.12.2026 | 1 |',
  '| Stații de robinete SR1, SR2 | 24.09.2025 | 07.12.2026 | 1 |',
  '| Probele de presiune (pe fiecare tronson) | 16.10.2026 | 19.11.2026 (T1: 30.11–11.12) | incluse |',
  '', '| Alt tabel | 01.01.2020 | 02.01.2020 |',
].join('\n')
const KM = '| T1 | 0+000 (0) | 2+000 (2000) | 2000 |\n| T2 | 2+000 (2000) | 5+000 (5000) | 3000 |'

describe('generatorul propunerii de legare (Lot 1)', () => {
  it('citește obiectele, perioadele și km-ii', () => {
    const { obiecte, altele } = obiecteDinCsv(CSV)
    expect(obiecte.map(o => `${o.obiect_cod}:${o.articole}`)).toEqual(['0001:2', '0002:1', '0012:1', '0013:1', '0019:1', '0025:1'])
    expect(altele).toEqual(['F4 Utilaje'])
    const p = perioadeDinGrafic(GRAFIC)
    expect(p.map(x => x.nume)).toEqual(['Organizare de șantier, drumuri acces', 'T1 km 0–2', 'T2 km 2–5', 'Cuplare Test', 'Stații de robinete SR1, SR2'])
    expect(p[1]).toEqual({ nume: 'T1 km 0–2', start: '2026-09-07', final: '2026-12-11' })
    expect(kmTronsoane(KM)).toEqual({ T1: '0+000 – 2+000', T2: '2+000 – 5+000' })
  })
  it('propune tronsoanele, nodul și obiectele cu perioadă; restul rămâne nepropus', () => {
    const { obiecte } = obiecteDinCsv(CSV)
    const r = propuneUnitati({ obiecte, perioade: perioadeDinGrafic(GRAFIC), km: kmTronsoane(KM), nodCuplare: 'NOD-CUPLARE-TEST' })
    expect(r.avert).toEqual([])
    expect(r.unitati.map(u => [u.cod, u.obiect_cod, u.nod_cod, u.plan_start])).toEqual([
      ['T1', '0001', null, '2026-09-07'], ['T2', '0002', null, '2026-06-29'], ['CUPLARE', '0012', 'NOD-CUPLARE-TEST', '2026-05-04'],
      ['0013', '0013', null, '2025-09-24'], ['0019', '0019', null, '2025-05-12']])
    expect(r.unitati[0].nume).toBe('Tronson 1 (km 0+000 – 2+000)')
    expect(r.unitati[3].nume).toBe('Statie de robinete')
    expect(r.nepropuse.map(o => o.obiect_cod)).toEqual(['0025'])
  })
  it('un rând de grafic ambiguu nu se propune (avertisment)', () => {
    const { obiecte } = obiecteDinCsv(CSV)
    const r = propuneUnitati({ obiecte: [...obiecte, { obiect_cod: '0099', obiect_nume: 'TRONSON 1', articole: 1 }], perioade: perioadeDinGrafic(GRAFIC) })
    expect(r.avert.some(a => /T1 km 0–2.*2 obiecte/.test(a))).toBe(true)
  })
  it('SQL-ul: o tranzacție, gărzi, inserează doar ce lipsește, completează doar ce e gol, ghilimelele dublate', () => {
    const sql = genereazaSql({ proiectId: 7, unitati: [{ tip: 'obiect', cod: 'X1', nume: "Nod d'test", obiect_cod: '0012', nod_cod: 'NOD-X', plan_start: '2026-01-01', plan_final: '2026-02-01' }] })
    expect(sql.startsWith('-- NERULAT')).toBe(true)
    expect(sql).toContain('BEGIN;')
    expect(sql.trim().endsWith('COMMIT;')).toBe(true)
    expect(sql).toContain("'Nod d''test'")
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.proiect_unitati WHERE proiect_id = 7 AND upper(coalesce(cod, '')) = 'X1')")
    expect(sql).toContain("SET obiect_cod = '0012' WHERE proiect_id = 7 AND upper(coalesce(cod, '')) = 'X1' AND obiect_cod IS NULL")
    expect(sql).toContain("SET nod_cod = 'NOD-X'")
    expect(sql).toContain("plan_start IS NULL;")
    expect(() => genereazaSql({ proiectId: '1; DROP', unitati: [] })).toThrow()
  })
})
