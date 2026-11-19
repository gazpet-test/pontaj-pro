import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx-js-style'
import {
  NORME_TOTAL_EXPORT, coloaneBrut, coloaneNet, antetTotaluriBrut, antetTotaluriNet,
  numaraNorme, totaluriBrutIntrare, totaluriNetIntrare,
} from './pontajExportColoane.js'

// TKT-2026-0368 (partea A): ZILE BO numărate în exporturile BRUT și NET, imediat după ZILE CM.
// Valorile așteptate (litere de coloană, numere) sunt socotite de mână, nu din modulul testat.
// Septembrie 2026: 30 de zile → zilele în D..AG (col 3..32).
const DAYS = 30
const ROW = 8 // primul angajat, rândul Ora Intrare
const LABELS = { CO: 'Concediu Odihnă', CM: 'Concediu Medical', BO: 'Boală Obișnuită', CFP: 'Concediu Fără Plată', O: 'Obligații Cetățenești' }
// Copie a NORME_ORE din exportPontajBrut (App.jsx) — neschimbată de tichet (conține deja BO)
const NORME_ORE = ['CO', 'CM', 'BO', 'BP', 'AM', 'M', 'O']

// Angajatul din brief: 3 CO (1–3.09), 1 CM (7.09), 2 BO (8–9.09), 1 CFP (10.09), restul zile goale
const normeZile = Array.from({ length: DAYS }, (_, i) => ({ 0: 'CO', 1: 'CO', 2: 'CO', 6: 'CM', 7: 'BO', 8: 'BO', 9: 'CFP' }[i] || ''))

// Foaia construită ca în App.jsx: antet (rândul 6 Excel) + rândul Ora Intrare al primului angajat (rândul 8)
function foaie(hdrTail, rowTail) {
  const dayNums = Array.from({ length: DAYS }, (_, i) => i + 1)
  const R = [[], [], [], [], [],
    ['NUME ȘI PRENUME SALARIAT', 'FUNCȚIA', 'PROGRAM DE LUCRU', ...dayNums, ...hdrTail],
    [],
    ['POPESCU ION', 'SUDOR', 'Ora Intrare', ...normeZile, ...rowTail]]
  return XLSX.utils.aoa_to_sheet(R)
}
// coloana (litera) cu antetul dat pe rândul 6
function colAntet(ws, text) {
  const r = XLSX.utils.decode_range(ws['!ref'])
  const gasite = []
  for (let c = 0; c <= r.e.c; c++) if (ws[XLSX.utils.encode_cell({ r: 5, c })]?.v === text) gasite.push(XLSX.utils.encode_col(c))
  expect(gasite, `antet „${text}”`).toHaveLength(1)
  return gasite[0]
}
const celula = (ws, col, row = ROW) => ws[`${col}${row}`]

// Evaluator minim pentru COUNTIF(<col><r>:<col><r>,"COD") pe un singur rând (potrivire exactă, ca Excel pe text)
function evalCountif(ws, f) {
  const m = /^COUNTIF\(([A-Z]+)(\d+):([A-Z]+)(\d+),"([^"]+)"\)$/.exec(f)
  if (!m) throw new Error('formula neașteptată: ' + f)
  const [, c0, r0, c1, r1, cod] = m
  expect(r0).toBe(r1)
  let n = 0
  for (let c = XLSX.utils.decode_col(c0); c <= XLSX.utils.decode_col(c1); c++) if (ws[XLSX.utils.encode_cell({ r: +r0 - 1, c })]?.v === cod) n++
  return n
}

describe('lista de norme numărate pe zile', () => {
  it('BO e numărat, imediat după CM; CM rămâne CM', () => {
    expect(NORME_TOTAL_EXPORT).toEqual(['CO', 'CM', 'BO', 'CFP', 'O'])
  })
})

describe('numaraNorme (BRUT)', () => {
  it('2 BO, 1 CM, 3 CO, 1 CFP → zile pe normă; ORE NORME tot pe 6 zile (CFP fără ore)', () => {
    const { normeCnt, zileNormeOre } = numaraNorme(normeZile, NORME_ORE)
    expect(normeCnt).toEqual({ CO: 3, CM: 1, BO: 2, CFP: 1, O: 0 })
    // înainte de tichet: CO 3 + CM 1 + BO 2 (BO era deja în NORME_ORE) = 6 zile × 8h = 48h → neschimbat
    expect(zileNormeOre).toBe(6)
  })
  it('coduri în afara listei (BP, N, LL) nu intră în zile, dar BP intră la ore', () => {
    const { normeCnt, zileNormeOre } = numaraNorme(['BP', 'N', 'LL', '', null], NORME_ORE)
    expect(normeCnt).toEqual({ CO: 0, CM: 0, BO: 0, CFP: 0, O: 0 })
    expect(zileNormeOre).toBe(1)
  })
})

describe('Pontaj BRUT: coloane și formule', () => {
  it('pozițiile se mută cu o coloană (30 de zile)', () => {
    // AH TOTAL ZILE, AI TOTAL ORE, AJ ORE SUPL, AK..AO zile CO/CM/BO/CFP/O, AP ORE NORME, AQ TOTAL ORE LUNĂ, AR ORE LUCR., AS etichetă, AT valoare
    const c = coloaneBrut(DAYS)
    const L = XLSX.utils.encode_col
    expect([c.TOTAL_ZILE_C, c.TOTAL_ORE_C, c.ORE_SUPL_C, c.NORME_C0, c.ORE_NORME_C, c.TOTAL_LUNA_C, c.ORE_LUCR_C, c.WD_LABEL_C, c.WD_VALUE_C].map(L))
      .toEqual(['AH', 'AI', 'AJ', 'AK', 'AP', 'AQ', 'AR', 'AS', 'AT'])
  })

  it('foaia generată: ZILE BO = 2, ZILE CM = 1, ORE NORME = 48, formulele refera coloanele corecte', () => {
    const { normeCnt, zileNormeOre } = numaraNorme(normeZile, NORME_ORE)
    const ant = antetTotaluriBrut(LABELS, NORME_ORE)
    const tail = totaluriBrutIntrare({ days: DAYS, excelRow: ROW, totalZile: 0, totalOre: 0, normeCnt, oreNorme: zileNormeOre * 8, oreLucratoare: 176 })
    expect(tail).toHaveLength(ant.hdr.length)
    expect(ant.dnr).toHaveLength(ant.hdr.length)
    const ws = foaie(ant.hdr, tail)

    expect(colAntet(ws, 'ZILE CM')).toBe('AL')
    expect(colAntet(ws, 'ZILE BO')).toBe('AM')
    expect(colAntet(ws, 'ZILE CFP')).toBe('AN')
    expect(celula(ws, 'AL').v).toBe(1)
    expect(celula(ws, 'AM').v).toBe(2)
    expect(celula(ws, 'AK').v).toBe(3)   // ZILE CO
    expect(celula(ws, 'AN').v).toBe(1)   // ZILE CFP
    expect(celula(ws, 'AO').v).toBe(0)   // ZILE O

    expect(colAntet(ws, 'ORE NORME (h normă/zi)')).toBe('AP')
    expect(celula(ws, 'AP').v).toBe(48)
    expect(colAntet(ws, 'TOTAL ORE LUNĂ')).toBe('AQ')
    expect(celula(ws, 'AQ').f).toBe('AI8+AP8')            // TOTAL ORE + ORE NORME
    expect(colAntet(ws, 'ORE LUCRĂTOARE')).toBe('AR')
    expect(celula(ws, 'AR').v).toBe(176)
    expect(colAntet(ws, 'ORE SUPLIMENTARE')).toBe('AJ')
    expect(celula(ws, 'AJ').f).toBe('MAX(0, AQ8 - AR8)')  // TOTAL ORE LUNĂ − ORE LUCRĂTOARE
    expect(colAntet(ws, 'TOTAL ORE')).toBe('AI')
  })

  it('rândul de sub antet: eticheta BO sub ZILE BO, textul ORE NORME neschimbat', () => {
    const ant = antetTotaluriBrut(LABELS, NORME_ORE)
    expect(ant.dnr[ant.hdr.indexOf('ZILE BO')]).toBe('Boală Obișnuită')
    expect(ant.dnr[ant.hdr.indexOf('ORE NORME (h normă/zi)')]).toBe('h normă × zile CO/CM/BO/BP/AM/M/O')
  })

  it('„Zile lucr. lună:” stă imediat după ORE LUCRĂTOARE, fără suprapunere (lună de 31 de zile)', () => {
    const c = coloaneBrut(31)
    const ant = antetTotaluriBrut(LABELS, NORME_ORE)
    // ultima coloană de antet = 3 + 31 + lungimea cozii − 1
    expect(c.WD_LABEL_C).toBe(3 + 31 + ant.hdr.length)
    expect(XLSX.utils.encode_col(c.WD_LABEL_C)).toBe('AT')
  })
})

describe('NET (foaia colectivă): coloane și formule', () => {
  it('pozițiile se mută cu o coloană (30 de zile)', () => {
    // AH TOTAL ZILE, AI TOTAL ORE, AJ..AN zile CO/CM/BO/CFP/O, AO etichetă, AP valoare
    const c = coloaneNet(DAYS)
    const L = XLSX.utils.encode_col
    expect([c.TOTAL_ZILE_C, c.TOTAL_ORE_C, c.NORME_C0, c.WD_LABEL_C, c.WD_VALUE_C, c.DATA_COL_END].map(L))
      .toEqual(['AH', 'AI', 'AJ', 'AO', 'AP', 'AG'])
  })

  it('foaia generată: COUNTIF pe ZILE BO dă 2, pe ZILE CM dă 1', () => {
    const ant = antetTotaluriNet(LABELS)
    const tail = totaluriNetIntrare({ days: DAYS, excelRow: ROW })
    expect(tail).toHaveLength(ant.hdr.length)
    expect(ant.dnr).toHaveLength(ant.hdr.length)
    const ws = foaie(ant.hdr, tail)

    expect(colAntet(ws, 'ZILE CM')).toBe('AK')
    expect(colAntet(ws, 'ZILE BO')).toBe('AL')
    expect(celula(ws, 'AL').f).toBe('COUNTIF(D8:AG8,"BO")')
    expect(evalCountif(ws, celula(ws, 'AL').f)).toBe(2)
    expect(evalCountif(ws, celula(ws, 'AK').f)).toBe(1)
    expect(evalCountif(ws, celula(ws, 'AJ').f)).toBe(3)   // CO
    expect(evalCountif(ws, celula(ws, 'AM').f)).toBe(1)   // CFP
    expect(evalCountif(ws, celula(ws, 'AN').f)).toBe(0)   // O („BO” nu e numărat ca „O”)
    // TOTAL ZILE / TOTAL ORE pe rândul Ore Lucrate (r+3), neschimbate
    expect(celula(ws, 'AH').f).toBe('COUNTIF(D11:AG11,">0")')
    expect(celula(ws, 'AI').f).toBe('SUM(D11:AG11)')
    expect(coloaneNet(DAYS).WD_LABEL_C).toBe(3 + DAYS + ant.hdr.length)
  })
})

describe('App.jsx folosește modulul în ambele exporturi', () => {
  const src = readFileSync(new URL('./App.jsx', import.meta.url), 'utf8')
  it('fără liste de norme sau poziții calculate local', () => {
    expect(src).not.toMatch(/NORME_TOTAL\s*=\s*\[/)
    expect(src).not.toMatch(/NORME_C0\s*=\s*FIXED/)
    expect(src).not.toMatch(/ORE_NORME_C\s*=\s*NORME_C0/)
    expect(src.match(/const NORME_TOTAL\s*=\s*NORME_TOTAL_EXPORT\b/g)).toHaveLength(2)
    expect(src).toMatch(/coloaneBrut\(days\)/)
    expect(src).toMatch(/coloaneNet\(days\)/)
    expect(src).toMatch(/rCI\.push\(\.\.\.totaluriBrutIntrare\(/)
    expect(src).toMatch(/rCI\.push\(\.\.\.totaluriNetIntrare\(/)
    expect(src).toMatch(/numaraNorme\(normeZile, NORME_ORE\)/)
    // NORME_ORE neschimbat (conține deja BO)
    expect(src).toMatch(/const NORME_ORE\s*=\s*\['CO','CM','BO','BP','AM','M','O'\]/)
  })
})
