// ===========================================================================
// EXPORT CENTRALIZATOR TRANSGAZ - Sub-faza E V3 TEMPLATE-BASED (21.05.2026)
// ---------------------------------------------------------------------------
//   • Sheet 1 CENTRALIZATOR — pixel-perfect (generat algoritmic, identic V2)
//   • Sheet 2 IZOMETRIE — V3 TEMPLATE-BASED:
//     - Folosesc transgazTemplate.js (extras din model.xlsx _00038)
//     - Clonez RAND_1 (R17-R29) pentru primul rand vizual
//     - Clonez RAND_N (R30-R42) pentru randurile 2+ cu wrap col B
//     - Substituiez DOAR valorile (POZ KM, SUDURA, SERIE, TIP, DIM, ȘARJĂ, LUNGIME)
//     - Borders + merges + row heights + col widths PRESERVAT 1:1 din template
//     - Garantat pixel-perfect identic vizual cu modelul Transgaz
//
// Input: { pachet, tronson, proiect, tevi } - obiecte direct din BD
// Output: Uint8Array - bytes xlsx pentru blob/download/upload Storage
// ===========================================================================

import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import {
  TRANSGAZ_HEADER_CELLS, TRANSGAZ_HEADER_MERGES,
  TRANSGAZ_RAND_1_CELLS, TRANSGAZ_RAND_1_MERGES, TRANSGAZ_RAND_1_ROW_HEIGHTS,
  TRANSGAZ_RAND_N_CELLS, TRANSGAZ_RAND_N_MERGES, TRANSGAZ_RAND_N_ROW_HEIGHTS,
  TRANSGAZ_COL_WIDTHS,
} from './transgazTemplate.js'
const XLSX = XLSX_mod.default || XLSX_mod

// ---------------------------------------------------------------------------
// STYLE CONSTANTS (Segoe UI 10pt, fill grey nuante, borders thin)
// ---------------------------------------------------------------------------
const FONT_BASE = { name: 'Segoe UI', sz: 10, color: { rgb: '000000' } }
const FONT_BOLD = { ...FONT_BASE, bold: true }
const FONT_SMALL = { ...FONT_BASE, sz: 9 } // pentru PM/PA-UT col K, L
const FONT_SMALL_BOLD = { ...FONT_SMALL, bold: true }

const FILL_LIGHT = { patternType: 'solid', fgColor: { rgb: 'F2F2F2' } } // header zone tint -0.05
const FILL_DARKER = { patternType: 'solid', fgColor: { rgb: 'D9D9D9' } } // cap tabel + total tint -0.15

const BORDER_THIN = {
  left:   { style: 'thin', color: { rgb: '000000' } },
  right:  { style: 'thin', color: { rgb: '000000' } },
  top:    { style: 'thin', color: { rgb: '000000' } },
  bottom: { style: 'thin', color: { rgb: '000000' } },
}
const BORDER_LR_THIN = {
  left:  { style: 'thin', color: { rgb: '000000' } },
  right: { style: 'thin', color: { rgb: '000000' } },
}
const BORDER_L_THIN = {
  left: { style: 'thin', color: { rgb: '000000' } },
}

const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' }
const ALIGN_CENTER_WRAP = { horizontal: 'center', vertical: 'center', wrapText: true }
const ALIGN_LEFT = { horizontal: 'left', vertical: 'center' }
const ALIGN_RIGHT = { horizontal: 'right', vertical: 'center' }

// ---------------------------------------------------------------------------
// COLOANE Centralizator (lățimi exacte din model)
// ---------------------------------------------------------------------------
const SHEET1_COL_WIDTHS = [
  { wch: 5.29 },   // A: POZ.
  { wch: 4.57 },   // B: LOT
  { wch: 13.43 },  // C: SERIE
  { wch: 3.86 },   // D: TIP
  { wch: 12.43 },  // E: DIMENSIUNE
  { wch: 6.57 },   // F: ȘARJA
  { wch: 8.71 },   // G: CANT.
  { wch: 7.71 },   // H: TRONSON
  { wch: 15.86 },  // I: POZ. KM
  { wch: 10.71 },  // J: SUDURĂ
  { wch: 15.29 },  // K: PM
  { wch: 13.71 },  // L: PA-UT / TOFD
  { wch: 14.14 },  // M: UT
  { wch: 34.57 },  // N: DOCUMENT
  { wch: 48.86 },  // O: OBS
]

const SHEET1_HEADER_LABELS = [
  'POZ.', 'LOT', 'SERIE\nUNICĂ DE\nIDENTIFICARE', 'TIP', 'DIMENSIUNE',
  'ȘARJĂ', 'CANT.', 'TRONSON', 'POZ. KM', 'SUDURĂ',
  'PM', 'PA-UT / TOFD', 'UT', 'DOCUMENT',
] // 14 cols A-N (O = OBS, fara border, fara label header)

// ---------------------------------------------------------------------------
// HELPER: Set cell with value + style + optional number format
// ---------------------------------------------------------------------------
function setCell(ws, addr, value, style = {}) {
  ws[addr] = { v: value, t: typeof value === 'number' ? 'n' : 's', s: style }
  if (style.numFmt) ws[addr].z = style.numFmt
}

// ---------------------------------------------------------------------------
// HELPER: Format POZ KM (m → "KM+MMM" cu 3 cifre padding pe metri)
// ---------------------------------------------------------------------------
function formatPozKm(m) {
  if (m == null) return ''
  const km = Math.floor(m / 1000)
  const meters = Math.round(m % 1000) // pot fi decimale, rotunjim
  return `${km}+${String(meters).padStart(3, '0')}`
}

// ---------------------------------------------------------------------------
// HELPER: Format sudura cod cu sufix R daca refacuta
// ---------------------------------------------------------------------------
function formatSudura(row) {
  if (!row.sudura_cod) return ''
  return row.sudura_refacuta ? `${row.sudura_cod} R` : row.sudura_cod
}

// ---------------------------------------------------------------------------
// FORMAT TYPE - identifica daca trebuie tratat ca numar pentru CANT
// ---------------------------------------------------------------------------
function setNumCell(ws, addr, num, style = {}) {
  if (num == null || num === '') {
    setCell(ws, addr, '', style)
    return
  }
  ws[addr] = { v: Number(num), t: 'n', s: style }
  if (style.numFmt) ws[addr].z = style.numFmt
}

// ---------------------------------------------------------------------------
// BUILD SHEET 1 — CENTRALIZATOR (pixel-perfect)
// ---------------------------------------------------------------------------
function buildSheet1Centralizator({ pachet, tronson, proiect, tevi }) {
  const ws = {}

  // ========== HEADER ZONE R1-R10 ==========
  // B2:G2 = TRANSGAZ S.A. (bold, fill grey)
  setCell(ws, 'B2', 'S.N.T.G.N. TRANSGAZ S.A.', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  // B3:G3 = UNITATEA DE IMPLEMENTARE
  setCell(ws, 'B3', 'UNITATEA DE IMPLEMENTARE SI MANAGEMENT PROIECTE', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  // B4:G4 = SERVICIUL LOGISTICĂ
  setCell(ws, 'B4', 'SERVICIUL LOGISTICĂ ȘI SUPORT EXECUȚIE', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  // A6:N6 = CONDUCTĂ DE TRANSPORT (bold, fill grey, border L+R thin, center)
  const conducta = proiect?.nume_complet || proiect?.nume || 'CONDUCTĂ DE TRANSPORT GAZE NATURALE'
  setCell(ws, 'A6', conducta, {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_CENTER, border: BORDER_LR_THIN,
  })
  // A8:N8 = SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE
  setCell(ws, 'A8', 'SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_CENTER, border: BORDER_LR_THIN,
  })
  // A10:C10 = EXECUTANT : (bold, align right, border L)
  setCell(ws, 'A10', 'EXECUTANT :', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_RIGHT, border: BORDER_L_THIN,
  })
  // D10:M10 = SC GAZPET INSTAL SRL (NORMAL, NU bold, fill grey, align left)
  setCell(ws, 'D10', 'SC GAZPET INSTAL SRL', {
    font: FONT_BASE, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })

  // ========== CAP TABEL R12 (bold, fill darker, border full, wrap, center) ==========
  const headerStyle = {
    font: FONT_BOLD, fill: FILL_DARKER, alignment: ALIGN_CENTER_WRAP, border: BORDER_THIN,
  }
  SHEET1_HEADER_LABELS.forEach((label, idx) => {
    const col = String.fromCharCode(65 + idx) // A=65
    setCell(ws, `${col}12`, label, headerStyle)
  })

  // ========== TOTAL LANSAT R13 (bold, fill darker, border full) ==========
  // A13:F13 merged = "TOTAL LANSAT :" (align right)
  setCell(ws, 'A13', 'TOTAL LANSAT :', {
    font: FONT_BOLD, fill: FILL_DARKER, alignment: ALIGN_RIGHT, border: BORDER_THIN,
  })
  // G13 = SUM formula cu format #,##0.00
  const lastDataRow = 13 + tevi.length // R14 to R(13+N)
  ws['G13'] = {
    f: `SUM(G14:G${lastDataRow})`, t: 'n',
    s: {
      font: FONT_BOLD, fill: FILL_DARKER, alignment: ALIGN_CENTER, border: BORDER_THIN,
      numFmt: '#,##0.00',
    },
    z: '#,##0.00',
  }
  // H13-N13 = empty cu fill darker + border (pentru continuitate vizuala)
  for (const col of ['H','I','J','K','L','M','N']) {
    setCell(ws, `${col}13`, '', {
      font: FONT_BOLD, fill: FILL_DARKER, alignment: ALIGN_CENTER, border: BORDER_THIN,
    })
  }

  // ========== DATA ROWS R14+ ==========
  // CONVENȚIE MODEL Transgaz _00033 (verificat 21.05.2026):
  //   - A: POZ counter (1, 2, 3, ...)
  //   - B: LOT cascadă (B15+ = =B{r-1}, B14 = valoare din BD)
  //   - C, D, E, F, G, I, J: FORMULE VLOOKUP din IZOMETRIE!$BR$17:$BY$<lastRow>
  //     C=col2 SERIE, D=col3 TIP, E=col4 DIM, F=col5 ȘARJĂ, G=col6 CANT, I=col7 POZ KM, J=col8 SUDURĂ
  //   - H: TRONSON cascadă (H15+ = =H{r-1})
  //   - K, L, M, O: valori directe (PM, PA-UT, UT, OBS)
  //   - N: COD_DOC cascadă (N15+ = =N{r-1})
  const cellStyleNum = { font: FONT_BOLD, alignment: ALIGN_RIGHT, border: BORDER_THIN }
  const cellStyleText = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const cellStyleNumData = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const cellStyleSmall = { font: FONT_SMALL, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const cellStyleObs = { font: FONT_BASE, alignment: ALIGN_CENTER }

  // Calc lastRow tabela master pentru range VLOOKUP dinamic
  const teviRealeCount = tevi.filter(t => t.tip_rand === 'teava').length
  const lastMasterTeavaRowS1 = teviRealeCount > 0 ? 17 + Math.floor((teviRealeCount - 1) / 10) * 13 + ((teviRealeCount - 1) % 10) : 17
  const nrCurbeLegariS1 = tevi.length - teviRealeCount
  const lastMasterRowS1 = lastMasterTeavaRowS1 + nrCurbeLegariS1
  const vlookupRange = `IZOMETRIE!$BR$17:$BY$${lastMasterRowS1}`

  tevi.forEach((row, idx) => {
    const r = 14 + idx
    const poz = idx + 1

    // A: POZ counter (valoare directă)
    setCell(ws, `A${r}`, poz, cellStyleNum)

    // B: LOT — B14 = valoare directă, B15+ = =B{r-1} cascadă
    if (idx === 0) {
      setCell(ws, `B${r}`, row.lot || '', cellStyleText)
    } else {
      ws[`B${r}`] = { f: `B${r - 1}`, v: row.lot || '', t: 's', s: cellStyleText }
    }

    // C: SERIE UNICĂ = VLOOKUP col 2
    ws[`C${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},2,FALSE)`, v: row.serie_unica || '', t: 's', s: cellStyleText }
    // D: TIP = VLOOKUP col 3
    ws[`D${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},3,FALSE)`, v: row.tip || '', t: 's', s: cellStyleText }
    // E: DIMENSIUNE = VLOOKUP col 4
    let dim = row.dimensiune || ''
    if (row.tip_rand === 'curba' && row.unghi_curba && !dim.includes(row.unghi_curba)) {
      dim = dim ? `${dim} ${row.unghi_curba}` : row.unghi_curba
    }
    ws[`E${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},4,FALSE)`, v: dim, t: 's', s: cellStyleText }
    // F: ȘARJĂ = VLOOKUP col 5
    ws[`F${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},5,FALSE)`, v: row.sarja || '', t: 's', s: cellStyleText }
    // G: CANT = VLOOKUP col 6
    if (row.lungime_m != null && row.lungime_m !== '') {
      ws[`G${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},6,FALSE)`, v: Number(row.lungime_m), t: 'n', s: { ...cellStyleNumData, numFmt: '#,##0.00' } }
    } else {
      setCell(ws, `G${r}`, '', cellStyleNumData)
    }

    // H: TRONSON — H14 = valoare, H15+ = =H{r-1} cascadă
    if (idx === 0) {
      setCell(ws, `H${r}`, tronson?.cod || '', cellStyleText)
    } else {
      ws[`H${r}`] = { f: `H${r - 1}`, v: tronson?.cod || '', t: 's', s: cellStyleText }
    }

    // I: POZ. KM = VLOOKUP col 7 (NU mai e valoare directă în model NOU _00033)
    const pozKmVal = row._poz_km != null ? row._poz_km : row.poz_km_m
    ws[`I${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},7,FALSE)`, v: formatPozKm(pozKmVal), t: 's', s: cellStyleText }

    // J: SUDURĂ = VLOOKUP col 8
    ws[`J${r}`] = { f: `VLOOKUP($A${r},${vlookupRange},8,FALSE)`, v: formatSudura(row), t: 's', s: cellStyleText }

    // K, L, M: PM, PA-UT, UT (valori directe)
    setCell(ws, `K${r}`, row.pm_cod || '', cellStyleSmall)
    setCell(ws, `L${r}`, row.pa_ut_cod || '', cellStyleSmall)
    setCell(ws, `M${r}`, row.ut_cod || '', cellStyleText)

    // N: DOCUMENT — N14 = valoare, N15+ = =N{r-1} cascadă
    const codDoc = pachet.cod_document_full + (pachet.revizie > 0 ? ` rev.${pachet.revizie}` : '')
    if (idx === 0) {
      setCell(ws, `N${r}`, codDoc, cellStyleText)
    } else {
      ws[`N${r}`] = { f: `N${r - 1}`, v: codDoc, t: 's', s: cellStyleText }
    }

    // O: OBS (fara border)
    setCell(ws, `O${r}`, row.observatii || '', cellStyleObs)
  })

  // ========== MERGED CELLS ==========
  ws['!merges'] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 6 } },   // B2:G2
    { s: { r: 2, c: 1 }, e: { r: 2, c: 6 } },   // B3:G3
    { s: { r: 3, c: 1 }, e: { r: 3, c: 6 } },   // B4:G4
    { s: { r: 5, c: 0 }, e: { r: 5, c: 13 } },  // A6:N6
    { s: { r: 7, c: 0 }, e: { r: 7, c: 13 } },  // A8:N8
    { s: { r: 9, c: 0 }, e: { r: 9, c: 2 } },   // A10:C10
    { s: { r: 9, c: 3 }, e: { r: 9, c: 12 } },  // D10:M10
    { s: { r: 12, c: 0 }, e: { r: 12, c: 5 } }, // A13:F13
  ]

  // ========== COLUMN WIDTHS ==========
  ws['!cols'] = SHEET1_COL_WIDTHS

  // ========== ROW HEIGHTS ==========
  ws['!rows'] = []
  ws['!rows'][11] = { hpt: 42.75 } // R12 cap tabel - inaltime ca in model

  // ========== FREEZE PANES — primele 12 rânduri (header + cap tabel) ==========
  // xlsx-js-style folosește !views array (NU !freeze obj)
  ws['!views'] = [{ state: 'frozen', xSplit: 0, ySplit: 12, topLeftCell: 'A13', activePane: 'bottomLeft' }]

  // ========== SHEET RANGE ==========
  ws['!ref'] = `A1:O${lastDataRow}`

  return ws
}

// ---------------------------------------------------------------------------
// BUILD SHEET 2 — IZOMETRIE V3 TEMPLATE-BASED (21.05.2026)
// ---------------------------------------------------------------------------
// Strategy: CLONEZ template din transgazTemplate.js (extras din model.xlsx _00038)
// pentru a obține PIXEL-PERFECT 1:1 cu modelul Transgaz original:
//   - Header zone R1-R12 (copy)
//   - Rand 1 vizual R17-R29 (template RAND_1, 504 cells, 48 merges)
//   - Rand 2+ vizual R30+ (template RAND_N, 517 cells, 52 merges)
//   - Toate borders + merges + row heights + col widths preserved din template
//   - SUBSTITUI doar valorile variabile (POZ KM, SUDURA, SERIE, TIP, DIM, ȘARJĂ, LUNGIME)
// ---------------------------------------------------------------------------

// Cells variabile per rand vizual (mapping col → poziție bloc)
// CONVENȚIE MODEL Transgaz (confirmat 21.05.2026):
//   - Rand 1: 10 țevi (POZ 1-10) afișate în 10 blocuri normale H-BJ
//   - Rand N>0: 10 țevi NOI + 1 wrap col B-G (DECORATION, fără SERIE/TIP sub)
//   - SERIE val e la PRIMUL col al blocului asociat țevii (H pentru POZ 1, N pentru POZ 2, ...)
//   - POZ KM val e la col+3 din bloc (K pentru bloc 1, Q pentru bloc 2, ...)
const RAND_1_POZ_KM_COLS = ['K', 'Q', 'W', 'AC', 'AI', 'AO', 'AU', 'BA', 'BG', 'BM'] // 10 blocuri
const RAND_1_SERIE_COLS = ['H', 'N', 'T', 'Z', 'AF', 'AL', 'AR', 'AX', 'BD', 'BJ']     // 10 țevi (POZ 1-10)
const RAND_N_POZ_KM_COLS = ['K', 'Q', 'W', 'AC', 'AI', 'AO', 'AU', 'BA', 'BG', 'BM']   // 10 blocuri normale (skip wrap col E)
const RAND_N_SERIE_COLS = ['H', 'N', 'T', 'Z', 'AF', 'AL', 'AR', 'AX', 'BD', 'BJ']     // 10 țevi noi

// Helper: deep clone cell (xlsx-js-style obj { v, t, s, f })
// IMPORTANT: cells cu DOAR style (border-only, fără valoare) trebuie să primească
// v:'' explicit, altfel xlsx-js-style le omite la writeFile (no v → cell stripped).
function cloneCell(cell) {
  const cloned = JSON.parse(JSON.stringify(cell))
  if (cloned.v === undefined && !cloned.f) {
    cloned.v = ''
    cloned.t = 's'
  }
  return cloned
}

// Helper: parse "K17" → { col: "K", row: 17 }
function parseAddr(addr) {
  const m = addr.match(/^([A-Z]+)(\d+)$/)
  return m ? { col: m[1], row: parseInt(m[2], 10) } : null
}

// Helper: convert col letters → 0-indexed number
function colToNum(col) {
  let n = 0
  for (let i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64)
  }
  return n - 1
}

function buildSheet2FromTemplate({ pachet, tronson, proiect, tevi }) {
  const ws = {}
  const allMerges = []
  const rowHeights = {}

  // ========== 1. HEADER (R1-R12) — copy + override values ==========
  for (const [addr, cell] of Object.entries(TRANSGAZ_HEADER_CELLS)) {
    ws[addr] = cloneCell(cell)
  }
  // Override B6 cu titlu proiect curent
  if (ws['B6']) {
    ws['B6'].v = proiect?.nume_complet || proiect?.nume || 'CONDUCTĂ DE TRANSPORT GAZE NATURALE'
    ws['B6'].t = 's'
    delete ws['B6'].f
  }
  // Override B8 cu cod document curent (template avea formula `="..."&CENTRALIZATOR!N14`)
  if (ws['B8']) {
    const codDoc = pachet.cod_document_full + (pachet.revizie > 0 ? ` rev.${pachet.revizie}` : '')
    ws['B8'].v = `SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE ${codDoc}`
    ws['B8'].t = 's'
    delete ws['B8'].f
  }
  // Header merges
  for (const m of TRANSGAZ_HEADER_MERGES) {
    allMerges.push({ s: { r: m.s.r, c: m.s.c }, e: { r: m.e.r, c: m.e.c } })
  }

  // ========== 2. Filter tevi reale + calc nrRanduri ==========
  const teviReale = tevi.filter(t => t.tip_rand === 'teava')
  const nrTeviReale = teviReale.length
  if (nrTeviReale === 0) {
    // Edge case: pachet fără țevi reale — doar header
    ws['!ref'] = 'A1:BZ12'
    ws['!merges'] = allMerges
    return ws
  }
  // CONVENȚIE MODEL: 10 țevi/rand (rand 1 = POZ 1-10, rand 2 = POZ 11-20, ...)
  const TEVI_PER_RAND = 10
  const nrRanduriVizuale = Math.max(1, Math.ceil(nrTeviReale / TEVI_PER_RAND))

  // ========== 3. Generez fiecare rand vizual din template ==========
  for (let randIdx = 0; randIdx < nrRanduriVizuale; randIdx++) {
    const outputRowBase = 17 + randIdx * 13 // R17, R30, R43, ...
    const isRand1 = randIdx === 0
    const templateCells = isRand1 ? TRANSGAZ_RAND_1_CELLS : TRANSGAZ_RAND_N_CELLS
    const templateMerges = isRand1 ? TRANSGAZ_RAND_1_MERGES : TRANSGAZ_RAND_N_MERGES
    const templateRowHeights = isRand1 ? TRANSGAZ_RAND_1_ROW_HEIGHTS : TRANSGAZ_RAND_N_ROW_HEIGHTS
    const templateRowStart = isRand1 ? 17 : 30
    const rowOffset = outputRowBase - templateRowStart

    // 3a. Copy cells din template cu rowOffset (skip cols >= 70 — lookup table generăm separat)
    for (const [addr, cell] of Object.entries(templateCells)) {
      const p = parseAddr(addr)
      if (!p) continue
      if (colToNum(p.col) >= 70) continue
      const newAddr = `${p.col}${p.row + rowOffset}`
      ws[newAddr] = cloneCell(cell)
    }

    // 3b. Copy merges cu rowOffset (skip merges din lookup cols)
    for (const m of templateMerges) {
      if (m.s.c >= 70) continue
      allMerges.push({
        s: { r: m.s.r + rowOffset, c: m.s.c },
        e: { r: m.e.r + rowOffset, c: m.e.c },
      })
    }

    // 3c. Copy row heights cu rowOffset
    for (const [rIdx, h] of Object.entries(templateRowHeights)) {
      rowHeights[parseInt(rIdx, 10) + rowOffset] = h
    }

    // 3d. SUBSTITUIESC valorile variabile
    const pozKmCols = isRand1 ? RAND_1_POZ_KM_COLS : RAND_N_POZ_KM_COLS
    const serieCols = isRand1 ? RAND_1_SERIE_COLS : RAND_N_SERIE_COLS
    const pozKmRow = outputRowBase
    const sudRow = outputRowBase + 1
    const serieRow = outputRowBase + 4
    const tipRow = serieRow + 1
    const dimRow = serieRow + 2
    const sarjaRow = serieRow + 3
    const lungRow = serieRow + 4

    const pozStart = randIdx * TEVI_PER_RAND // POZ 1-10 pe rand 0, POZ 11-20 pe rand 1, etc.

    // === WRAP DECORATION pe rand N>0 (col B-G) ===
    // Wrap = REPEAT ultima sudură din rand precedent (POZ pozStart, care e ultim POZ rand prev)
    if (!isRand1) {
      const wrapPipe = teviReale[pozStart - 1] // POZ {pozStart} = ultima teva rand prev (1-indexed)
      if (wrapPipe) {
        const wrapKmAddr = `E${pozKmRow}`
        const wrapSudAddr = `E${sudRow}`
        if (ws[wrapKmAddr]) {
          ws[wrapKmAddr].v = formatPozKm(wrapPipe._poz_km != null ? wrapPipe._poz_km : wrapPipe.poz_km_m)
          ws[wrapKmAddr].t = 's'
          delete ws[wrapKmAddr].f
        }
        if (ws[wrapSudAddr]) {
          ws[wrapSudAddr].v = formatSudura(wrapPipe)
          ws[wrapSudAddr].t = 's'
          delete ws[wrapSudAddr].f
        }
      }
      // SERIE/TIP/etc sub wrap = DECORATION goale (template are cells fără value, păstrăm așa)
    }

    // === BLOCURI NORMALE (cols K..BM pentru POZ KM, H..BJ pentru SERIE) ===
    // Rand 1: blocuri 0..9 = POZ 1..10
    // Rand N>0: blocuri 0..9 = POZ {pozStart+1}..{pozStart+10}
    for (let b = 0; b < TEVI_PER_RAND; b++) {
      const pozIdx = pozStart + b // 0-indexed în teviReale
      const pipe = teviReale[pozIdx]
      const col_km = pozKmCols[b]
      const col_serie = serieCols[b]

      if (!pipe) {
        // Nu mai există țevi — clear cells pentru blocurile suplimentare
        if (col_km) {
          for (const r of [pozKmRow, sudRow]) {
            const a = `${col_km}${r}`
            if (ws[a]) { ws[a].v = ''; ws[a].t = 's'; delete ws[a].f }
          }
        }
        if (col_serie) {
          for (const r of [serieRow, tipRow, dimRow, sarjaRow, lungRow]) {
            const a = `${col_serie}${r}`
            if (ws[a]) { ws[a].v = ''; ws[a].t = 's'; delete ws[a].f }
          }
        }
        continue
      }

      // POZ KM value
      const kmAddr = `${col_km}${pozKmRow}`
      if (ws[kmAddr]) {
        const pozKmVal = formatPozKm(pipe._poz_km != null ? pipe._poz_km : pipe.poz_km_m)
        ws[kmAddr].v = pozKmVal
        ws[kmAddr].t = 's'
        delete ws[kmAddr].f
      }
      // SUDURA value
      const sudAddr = `${col_km}${sudRow}`
      if (ws[sudAddr]) {
        ws[sudAddr].v = formatSudura(pipe)
        ws[sudAddr].t = 's'
        delete ws[sudAddr].f
      }
      // SERIE/TIP/DIM/ȘARJĂ/LUNGIME (la col_serie = primul col al blocului asociat țevii)
      const fields = [
        [`${col_serie}${serieRow}`, pipe.serie_unica || '', 's'],
        [`${col_serie}${tipRow}`, pipe.tip || '', 's'],
        [`${col_serie}${dimRow}`, pipe.dimensiune || '', 's'],
        [`${col_serie}${sarjaRow}`, pipe.sarja || '', 's'],
        [`${col_serie}${lungRow}`, pipe.lungime_m != null ? Number(pipe.lungime_m) : '', pipe.lungime_m != null ? 'n' : 's'],
      ]
      for (const [addr, val, type] of fields) {
        if (ws[addr]) {
          ws[addr].v = val
          ws[addr].t = type
          delete ws[addr].f
        }
      }
    }
  }

  // ========== 4. Lookup table BR14:BY — FORMULE care trag din schema vizuală ==========
  // CONVENȚIE MODEL Transgaz _00033 (verificat 21.05.2026):
  //   - Tabela master 8 cols la BR-BY:
  //     BR = POZ counter (BR17=1, BR18=BR17+1, cascadă)
  //     BS = SERIE (=H21), BT = TIP (=H22), BU = DIM (=H23), BV = ȘARJĂ (=H24)
  //     BW = CANT (=H25), BX = POZ KM (=K17), BY = SUDURĂ (=K18)
  //   - Header la R14, R27, R40, ... (repetat per rand vizual, +13 rânduri)
  //   - POZ-uri grupate per rand: R17-R26 (POZ 1-10), R30-R39 (POZ 11-20), R43-R52 (POZ 21-30), ...
  //   - Pentru curbe/legări (NU sunt în schema vizuală) → valori directe din BD
  const lookupHeaderStyle = {
    font: { ...FONT_BOLD, sz: 8 }, fill: FILL_DARKER, alignment: ALIGN_CENTER_WRAP, border: BORDER_THIN,
  }
  const dataStyle = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const dataNumStyle = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN, numFmt: '#,##0.00' }

  // Helper: calc row în tabela master pentru POZ i (0-indexed)
  const rowMaster = (i) => 17 + Math.floor(i / 10) * 13 + (i % 10)

  // 4a. Header repetat la R14, R27, R40, ... per rand vizual
  // În model header e MERGE pe 3 rânduri vertical (R14:R16, R27:R29, etc.) — fără gap între header și POZ-uri
  for (let randIdx = 0; randIdx < nrRanduriVizuale; randIdx++) {
    const headerRow = 14 + randIdx * 13
    setCell(ws, `BR${headerRow}`, 'POZ.', lookupHeaderStyle)
    setCell(ws, `BS${headerRow}`, 'SERIE\r\nUNICĂ DE\r\nIDENTIFICARE', lookupHeaderStyle)
    setCell(ws, `BT${headerRow}`, 'TIP', lookupHeaderStyle)
    setCell(ws, `BU${headerRow}`, 'DIMENSIUNE', lookupHeaderStyle)
    setCell(ws, `BV${headerRow}`, 'ȘARJĂ', lookupHeaderStyle)
    setCell(ws, `BW${headerRow}`, 'CANT.', lookupHeaderStyle)
    setCell(ws, `BX${headerRow}`, 'POZ. KM', lookupHeaderStyle)
    setCell(ws, `BY${headerRow}`, 'SUDURĂ', lookupHeaderStyle)
    // Merge headers pe 3 rânduri (R14:R16, R27:R29, R40:R42, ...)
    // SheetJS merges folosește 0-indexed: BR=69, BS=70, BT=71, BU=72, BV=73, BW=74, BX=75, BY=76
    for (let col = 69; col <= 76; col++) {
      allMerges.push({
        s: { r: headerRow - 1, c: col },     // R14 = row index 13 (0-indexed)
        e: { r: headerRow - 1 + 2, c: col }, // R16 = row index 15
      })
    }
  }

  // 4b. POZ-uri rânduri — formule la schema vizuală pentru țevi, valori directe pentru curbe/legări
  const tableMasterRows = tevi

  let teavaIdx = 0
  tableMasterRows.forEach((row, idx) => {
    let r
    if (row.tip_rand === 'teava') {
      r = rowMaster(teavaIdx)
    } else {
      r = rowMaster(nrTeviReale - 1) + (idx - teavaIdx) + 1
    }

    // BR = POZ counter (formulă cascadă)
    const poz = idx + 1
    if (idx === 0) {
      setNumCell(ws, `BR${r}`, poz, { ...dataStyle, font: FONT_BOLD })
    } else {
      // Formula =BR{r_prev}+1
      let r_prev
      if (row.tip_rand === 'teava' && tableMasterRows[idx - 1].tip_rand === 'teava') {
        r_prev = rowMaster(teavaIdx - 1)
        ws[`BR${r}`] = { f: `BR${r_prev}+1`, v: poz, t: 'n', s: { ...dataStyle, font: FONT_BOLD } }
      } else {
        // Mixed scenario sau curbă/legare — valoare directă
        setNumCell(ws, `BR${r}`, poz, { ...dataStyle, font: FONT_BOLD })
      }
    }

    if (row.tip_rand === 'teava') {
      // Formule la schema vizuală
      const rand_idx = Math.floor(teavaIdx / 10)
      const pos = teavaIdx % 10
      const schema_pozkm_row = 17 + rand_idx * 13
      const schema_sud_row = schema_pozkm_row + 1
      const schema_serie_row = schema_pozkm_row + 4
      const col_km = RAND_1_POZ_KM_COLS[pos]
      const col_serie = RAND_1_SERIE_COLS[pos]

      ws[`BS${r}`] = { f: `${col_serie}${schema_serie_row}`, v: row.serie_unica || '', t: 's', s: dataStyle }
      ws[`BT${r}`] = { f: `${col_serie}${schema_serie_row + 1}`, v: row.tip || '', t: 's', s: dataStyle }
      ws[`BU${r}`] = { f: `${col_serie}${schema_serie_row + 2}`, v: row.dimensiune || '', t: 's', s: dataStyle }
      ws[`BV${r}`] = { f: `${col_serie}${schema_serie_row + 3}`, v: row.sarja || '', t: 's', s: dataStyle }
      ws[`BW${r}`] = { f: `${col_serie}${schema_serie_row + 4}`, v: row.lungime_m != null ? Number(row.lungime_m) : '', t: 'n', s: dataNumStyle }
      ws[`BX${r}`] = { f: `${col_km}${schema_pozkm_row}`, v: formatPozKm(row._poz_km != null ? row._poz_km : row.poz_km_m), t: 's', s: dataStyle }
      ws[`BY${r}`] = { f: `${col_km}${schema_sud_row}`, v: formatSudura(row), t: 's', s: dataStyle }
      teavaIdx++
    } else {
      // Curbă/legare — valori directe
      setCell(ws, `BS${r}`, row.serie_unica || '', dataStyle)
      setCell(ws, `BT${r}`, row.tip || '', dataStyle)
      let dim = row.dimensiune || ''
      if (row.tip_rand === 'curba' && row.unghi_curba && !dim.includes(row.unghi_curba)) {
        dim = dim ? `${dim} ${row.unghi_curba}` : row.unghi_curba
      }
      setCell(ws, `BU${r}`, dim, dataStyle)
      setCell(ws, `BV${r}`, row.sarja || '', dataStyle)
      if (row.lungime_m != null && row.lungime_m !== '') {
        setNumCell(ws, `BW${r}`, row.lungime_m, dataNumStyle)
      } else {
        setCell(ws, `BW${r}`, '', dataStyle)
      }
      const pozKmVal = row._poz_km != null ? row._poz_km : row.poz_km_m
      setCell(ws, `BX${r}`, formatPozKm(pozKmVal), dataStyle)
      setCell(ws, `BY${r}`, formatSudura(row), dataStyle)
    }
  })

  // ========== 5. Set merges + row heights + col widths ==========
  ws['!merges'] = allMerges

  // Row R16 = 11.25 pt (din model — adăugat înainte de populare ws['!rows'])
  rowHeights[16] = 11.25

  ws['!rows'] = []
  for (const [rIdx, h] of Object.entries(rowHeights)) {
    ws['!rows'][parseInt(rIdx, 10)] = { hpt: h }
  }

  ws['!cols'] = []
  // PENTRU MODEL TRANSGAZ _00033 — valori EXACTE din model.
  // Cols schema vizuală: pattern repetitiv per BLOC (6 cols)
  // Per bloc: [default=2.71, default=2.71, 2.71, 1.71, default=2.71, 2.71, 12.71]
  // Folosim valoarea EXPLICITĂ din model (xlsx-js-style adaugă padding implicit dacă lăsăm default).
  const COL_WIDTHS_MODEL = {
    1: 2.71, 2: 4.86, 3: 2.71, 4: 1.71, // A B C D
    // E (5) default 2.71
    6: 2.71, 7: 12.71, // F G
    // H (8) default 2.71
    9: 2.71, 10: 1.71, // I J
    // K (11) default 2.71
    12: 2.71, 13: 12.71, // L M
    // N (14) default
    15: 2.71, 16: 1.71, // O P
    // Q (17) default
    18: 2.71, 19: 12.71, // R S
    // T (20) default
    21: 2.71, 22: 1.71, // U V
    // W (23) default
    24: 2.71, 25: 12.71, // X Y
    // Z (26) default
    27: 2.71, 28: 1.71, // AA AB
    // AC (29) default
    30: 2.71, 31: 12.71, // AD AE
    // AF (32) default
    33: 2.71, 34: 1.71, // AG AH
    // AI (35) default
    36: 2.71, 37: 12.71, // AJ AK
    // AL (38) default
    39: 2.71, 40: 1.71, // AM AN
    // AO (41) default
    42: 2.71, 43: 12.71, // AP AQ
    // AR (44) default
    45: 2.71, 46: 1.71, // AS AT
    // AU (47) default
    48: 2.71, 49: 12.71, // AV AW
    // AX (50) default
    51: 2.71, 52: 1.71, // AY AZ
    // BA (53) default
    54: 2.71, 55: 12.71, // BB BC
    // BD (56) default
    57: 2.71, 58: 1.71, // BE BF
    // BG (59) default
    60: 2.71, 61: 12.71, // BH BI
    // BJ (62) default
    63: 2.71, 64: 1.71, // BK BL
    // BM (65) default
    66: 2.71, 67: 12.71, // BN BO
    // Lookup table BR-BY (cu BP, BQ înainte)
    68: 2.71, 69: 3.57, // BP BQ
    70: 4.57,  // BR (POZ counter)
    71: 11.29, // BS (SERIE)
    72: 3.29,  // BT (TIP)
    73: 10.86, // BU (DIM)
    74: 5.86,  // BV (ȘARJĂ)
    75: 5.71,  // BW (CANT)
    76: 7.57,  // BX (POZ KM)
    77: 7.43,  // BY (SUDURĂ)
  }
  for (const [cIdx, w] of Object.entries(COL_WIDTHS_MODEL)) {
    // SheetJS folosește 1-indexed in '!cols' array (index 0 = col A)
    // openpyxl folosește 1-indexed cu litere. cIdx aici e 1=A, 2=B, ...
    ws['!cols'][parseInt(cIdx, 10) - 1] = { wch: w }
  }

  // ========== 6. Sheet range ==========
  const lastVisualRow = 17 + nrRanduriVizuale * 13
  // Tabela master: ultim POZ țeavă + extra rows pentru curbe/legări
  const lastMasterTeavaRow = nrTeviReale > 0 ? rowMaster(nrTeviReale - 1) : 16
  const nrExtraMasterRows = tevi.length - nrTeviReale // curbe + legări
  const lastMasterRow = lastMasterTeavaRow + nrExtraMasterRows
  const lastRow = Math.max(lastVisualRow, lastMasterRow)
  ws['!ref'] = `A1:BZ${lastRow}`

  return ws
}

// ---------------------------------------------------------------------------
// MAIN: Generate workbook + return as Uint8Array (bytes)
// ---------------------------------------------------------------------------
export async function generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }) {
  if (!pachet) throw new Error('Pachet obligatoriu')
  if (!Array.isArray(tevi)) throw new Error('Lista tevi obligatorie')

  // Filter out separatori (NU apar in centralizator Transgaz)
  const teviFiltered = tevi.filter(t => t.tip_rand !== 'separator')

  // Compute POZ KM cumulativ daca lipseste
  const teviWithPozKm = computePozKmCascade(teviFiltered, pachet.km_start_m || 0)

  // Build workbook
  const wb = XLSX.utils.book_new()
  const ws1 = buildSheet1Centralizator({ pachet, tronson, proiect, tevi: teviWithPozKm })
  const ws2 = buildSheet2FromTemplate({ pachet, tronson, proiect, tevi: teviWithPozKm })

  XLSX.utils.book_append_sheet(wb, ws1, 'CENTRALIZATOR')
  XLSX.utils.book_append_sheet(wb, ws2, 'IZOMETRIE')

  // Write to Uint8Array
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })

  // POST-PROCESS cu JSZip: adaug freeze panes pe Sheet 1 + cols exacte pe Sheet 2
  // xlsx-js-style nu suportă freeze panes direct + face padding +0.83 char la widths.
  const zip = await JSZip.loadAsync(out)

  // Sheet 1: freeze panes A13
  const sheet1Path = 'xl/worksheets/sheet1.xml'
  let sheet1Xml = await zip.file(sheet1Path).async('string')
  const sheetViewsXml = '<sheetViews><sheetView workbookViewId="0"><pane xSplit="0" ySplit="12" topLeftCell="A13" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
  if (sheet1Xml.includes('<sheetViews>')) {
    sheet1Xml = sheet1Xml.replace(/<sheetViews>.*?<\/sheetViews>/, sheetViewsXml)
  } else {
    sheet1Xml = sheet1Xml.replace(/(<dimension[^/]*\/>)/, `$1${sheetViewsXml}`)
  }
  zip.file(sheet1Path, sheet1Xml)

  // Sheet 2: cols widths EXACTE din model_new _00033 (xlsx-js-style adaugă padding implicit)
  const sheet2Path = 'xl/worksheets/sheet2.xml'
  let sheet2Xml = await zip.file(sheet2Path).async('string')
  const colsModelXml = '<cols><col min="1" max="1" width="2.7109375" customWidth="1"/><col min="2" max="2" width="4.85546875" customWidth="1"/><col min="3" max="3" width="2.7109375" customWidth="1"/><col min="4" max="5" width="1.7109375" customWidth="1"/><col min="6" max="6" width="2.7109375"/><col min="7" max="8" width="12.7109375" customWidth="1"/><col min="9" max="9" width="2.7109375"/><col min="10" max="11" width="1.7109375" customWidth="1"/><col min="12" max="12" width="2.7109375"/><col min="13" max="14" width="12.7109375" customWidth="1"/><col min="15" max="15" width="2.7109375"/><col min="16" max="17" width="1.7109375" customWidth="1"/><col min="18" max="18" width="2.7109375"/><col min="19" max="20" width="12.7109375" customWidth="1"/><col min="21" max="21" width="2.7109375"/><col min="22" max="23" width="1.7109375" customWidth="1"/><col min="24" max="24" width="2.7109375"/><col min="25" max="26" width="12.7109375" customWidth="1"/><col min="27" max="27" width="2.7109375"/><col min="28" max="29" width="1.7109375" customWidth="1"/><col min="30" max="30" width="2.7109375"/><col min="31" max="32" width="12.7109375" customWidth="1"/><col min="33" max="33" width="2.7109375"/><col min="34" max="35" width="1.7109375" customWidth="1"/><col min="36" max="36" width="2.7109375"/><col min="37" max="38" width="12.7109375" customWidth="1"/><col min="39" max="39" width="2.7109375"/><col min="40" max="41" width="1.7109375" customWidth="1"/><col min="42" max="42" width="2.7109375"/><col min="43" max="44" width="12.7109375" customWidth="1"/><col min="45" max="45" width="2.7109375"/><col min="46" max="47" width="1.7109375" customWidth="1"/><col min="48" max="48" width="2.7109375"/><col min="49" max="50" width="12.7109375" customWidth="1"/><col min="51" max="51" width="2.7109375"/><col min="52" max="53" width="1.7109375" customWidth="1"/><col min="54" max="54" width="2.7109375"/><col min="55" max="56" width="12.7109375" customWidth="1"/><col min="57" max="57" width="2.7109375"/><col min="58" max="59" width="1.7109375" customWidth="1"/><col min="60" max="60" width="2.7109375"/><col min="61" max="62" width="12.7109375" customWidth="1"/><col min="63" max="63" width="2.7109375"/><col min="64" max="65" width="1.7109375" customWidth="1"/><col min="66" max="66" width="2.7109375"/><col min="67" max="67" width="12.7109375" customWidth="1"/><col min="68" max="68" width="2.7109375"/><col min="69" max="69" width="3.5703125" customWidth="1"/><col min="70" max="70" width="4.5703125" bestFit="1" customWidth="1"/><col min="71" max="71" width="11.28515625" bestFit="1" customWidth="1"/><col min="72" max="72" width="3.28515625" bestFit="1" customWidth="1"/><col min="73" max="73" width="10.85546875" bestFit="1" customWidth="1"/><col min="74" max="74" width="5.85546875" bestFit="1" customWidth="1"/><col min="75" max="75" width="5.7109375" bestFit="1" customWidth="1"/><col min="76" max="76" width="7.5703125" bestFit="1" customWidth="1"/><col min="77" max="77" width="7.42578125" bestFit="1" customWidth="1"/><col min="78" max="78" width="2.7109375" customWidth="1"/><col min="79" max="16384" width="2.7109375"/></cols>'
  if (sheet2Xml.includes('<cols>')) {
    sheet2Xml = sheet2Xml.replace(/<cols>.*?<\/cols>/, colsModelXml)
  } else {
    sheet2Xml = sheet2Xml.replace(/(<sheetData>)/, `${colsModelXml}$1`)
  }
  // Inject <drawing> reference în sheet2.xml înainte de </worksheet>
  if (!sheet2Xml.includes('<drawing ')) {
    sheet2Xml = sheet2Xml.replace(/(<\/worksheet>)/, '<drawing r:id="rId1"/>$1')
    // Adaug namespace r dacă lipsește în root <worksheet>
    if (!sheet2Xml.includes('xmlns:r=')) {
      sheet2Xml = sheet2Xml.replace(/(<worksheet[^>]+)>/, '$1 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">')
    }
  }
  // Scot merge B8:H8 ca textul "SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE..." să se extindă peste cells goale
  sheet2Xml = sheet2Xml.replace(/<mergeCell ref="B8:H8"\/>/g, '')
  // Update count attribute pe mergeCells dacă există
  sheet2Xml = sheet2Xml.replace(/<mergeCells count="(\d+)">/, (m, c) => `<mergeCells count="${parseInt(c) - 1}">`)
  zip.file(sheet2Path, sheet2Xml)

  // Adaug drawing1.xml (săgeată albastră "SENS CURGERE GAZ", ancorată cols 7-12 rows 10-12)
  const drawingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>9524</xdr:colOff><xdr:row>10</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>828674</xdr:colOff><xdr:row>12</xdr:row><xdr:rowOff>9525</xdr:rowOff></xdr:to><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Arrow: Right 1"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="1952624" y="1333500"/><a:ext cx="2257425" cy="276225"/></a:xfrm><a:prstGeom prst="rightArrow"><a:avLst/></a:prstGeom></xdr:spPr><xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style><xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip" rtlCol="0" anchor="t"/><a:lstStyle/><a:p><a:pPr algn="l"/><a:endParaRPr lang="en-US" sz="1100"/></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>'
  zip.file('xl/drawings/drawing1.xml', drawingXml)

  // Adaug relations pentru sheet2 → drawing
  const sheet2RelsPath = 'xl/worksheets/_rels/sheet2.xml.rels'
  const sheet2RelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>'
  zip.file(sheet2RelsPath, sheet2RelsXml)

  // Update [Content_Types].xml cu Override pentru drawing1.xml
  let contentTypesXml = await zip.file('[Content_Types].xml').async('string')
  if (!contentTypesXml.includes('drawing1.xml')) {
    const drawingOverride = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    contentTypesXml = contentTypesXml.replace('</Types>', `${drawingOverride}</Types>`)
    zip.file('[Content_Types].xml', contentTypesXml)
  }

  const finalBytes = await zip.generateAsync({ type: 'uint8array' })

  return finalBytes
}

// ---------------------------------------------------------------------------
// HELPER: Compute POZ KM cumulativ (fallback daca BD nu il are stocat)
// ---------------------------------------------------------------------------
function computePozKmCascade(tevi, kmStart) {
  let cumulat = kmStart
  return tevi.map((t, i) => {
    if (i > 0 && (t.tip_rand === 'teava' || t.tip_rand === 'curba') && t.lungime_m) {
      cumulat += Number(t.lungime_m)
    }
    return { ...t, _poz_km: t.poz_km_m != null ? t.poz_km_m : cumulat }
  })
}

// ---------------------------------------------------------------------------
// FILENAME helper
// ---------------------------------------------------------------------------
export function buildCentralizatorFilename(pachet) {
  const rev = pachet.revizie > 0 ? `_rev${pachet.revizie}` : '_rev0'
  return `${pachet.cod_document_full}${rev}_Centralizator.xlsx`
}
