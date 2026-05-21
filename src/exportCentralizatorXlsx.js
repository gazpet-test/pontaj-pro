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
  // Stiluri pre-create (reused per row pentru reduce alocari)
  const cellStyleNum = { font: FONT_BOLD, alignment: ALIGN_RIGHT, border: BORDER_THIN } // pentru POZ
  const cellStyleText = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const cellStyleNumData = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN } // pentru CANT
  const cellStyleSmall = { font: FONT_SMALL, alignment: ALIGN_CENTER, border: BORDER_THIN } // pentru K/L (9pt)
  const cellStyleObs = { font: FONT_BASE, alignment: ALIGN_CENTER } // O fara border

  tevi.forEach((row, idx) => {
    const r = 14 + idx
    const poz = idx + 1

    // A: POZ (numar, bold, right)
    setCell(ws, `A${r}`, poz, cellStyleNum)
    // B: LOT
    setCell(ws, `B${r}`, row.lot || '', cellStyleText)
    // C: SERIE UNICA
    setCell(ws, `C${r}`, row.serie_unica || '', cellStyleText)
    // D: TIP
    setCell(ws, `D${r}`, row.tip || '', cellStyleText)
    // E: DIMENSIUNE
    let dim = row.dimensiune || ''
    if (row.tip_rand === 'curba' && row.unghi_curba && !dim.includes(row.unghi_curba)) {
      dim = dim ? `${dim} ${row.unghi_curba}` : row.unghi_curba
    }
    setCell(ws, `E${r}`, dim, cellStyleText)
    // F: ȘARJA
    setCell(ws, `F${r}`, row.sarja || '', cellStyleText)
    // G: CANT (lungime_m, numeric cu format)
    if (row.lungime_m != null && row.lungime_m !== '') {
      setNumCell(ws, `G${r}`, row.lungime_m, { ...cellStyleNumData, numFmt: '#,##0.00' })
    } else {
      setCell(ws, `G${r}`, '', cellStyleNumData)
    }
    // H: TRONSON
    setCell(ws, `H${r}`, tronson?.cod || '', cellStyleText)
    // I: POZ. KM (formatted din m → KM+MMM)
    const pozKmVal = row._poz_km != null ? row._poz_km : row.poz_km_m
    setCell(ws, `I${r}`, formatPozKm(pozKmVal), cellStyleText)
    // J: SUDURĂ (cu R sufix daca refacuta)
    setCell(ws, `J${r}`, formatSudura(row), cellStyleText)
    // K: PM (font 9pt)
    setCell(ws, `K${r}`, row.pm_cod || '', cellStyleSmall)
    // L: PA-UT (font 9pt)
    setCell(ws, `L${r}`, row.pa_ut_cod || '', cellStyleSmall)
    // M: UT
    setCell(ws, `M${r}`, row.ut_cod || '', cellStyleText)
    // N: DOCUMENT (cod pachet + rev)
    const codDoc = pachet.cod_document_full + (pachet.revizie > 0 ? ` rev.${pachet.revizie}` : '')
    setCell(ws, `N${r}`, codDoc, cellStyleText)
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
const RAND_1_POZ_KM_COLS = ['K', 'Q', 'W', 'AC', 'AI', 'AO', 'AU', 'BA', 'BG', 'BM'] // 10 blocuri
const RAND_1_SERIE_COLS = ['N', 'T', 'Z', 'AF', 'AL', 'AR', 'AX', 'BD', 'BJ']         // 9 țevi sub blocuri 0..8
const RAND_N_POZ_KM_COLS = ['E', 'K', 'Q', 'W', 'AC', 'AI', 'AO', 'AU', 'BA', 'BG', 'BM'] // 11 (wrap + 10)
const RAND_N_SERIE_COLS = ['H', 'N', 'T', 'Z', 'AF', 'AL', 'AR', 'AX', 'BD', 'BJ']         // 10 țevi (sub wrap + 9 normale)

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
  // Rand 1 = 9 țevi (cu blocuri 0..8 ca tevaData; bloc 9 = wrap pentru rand 2)
  // Rand N>0 = 9 țevi (wrap + blocuri 1..8)
  // Total tevi consumate per N+1 randuri = 9 * (N+1) → nrRanduriVizuale = ceil(N/9)
  const nrRanduriVizuale = Math.max(1, Math.ceil(nrTeviReale / 9))

  // ========== 3. Generez fiecare rand vizual din template ==========
  let pipeIdx = 0
  for (let randIdx = 0; randIdx < nrRanduriVizuale; randIdx++) {
    const outputRowBase = 17 + randIdx * 13 // R17, R30, R43, ...
    const isRand1 = randIdx === 0
    const templateCells = isRand1 ? TRANSGAZ_RAND_1_CELLS : TRANSGAZ_RAND_N_CELLS
    const templateMerges = isRand1 ? TRANSGAZ_RAND_1_MERGES : TRANSGAZ_RAND_N_MERGES
    const templateRowHeights = isRand1 ? TRANSGAZ_RAND_1_ROW_HEIGHTS : TRANSGAZ_RAND_N_ROW_HEIGHTS
    const templateRowStart = isRand1 ? 17 : 30
    const rowOffset = outputRowBase - templateRowStart

    // 3a. Copy cells din template cu rowOffset
    // SKIP cells din cols >= 70 (BS+) — lookup table generăm separat mai jos
    for (const [addr, cell] of Object.entries(templateCells)) {
      const p = parseAddr(addr)
      if (!p) continue
      if (colToNum(p.col) >= 70) continue // skip lookup table cols
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

    const pozKmRow = outputRowBase           // 17 / 30+offset
    const sudRow = outputRowBase + 1         // 18 / 31+offset
    const serieRow = outputRowBase + 4       // 21 / 34+offset
    const tipRow = serieRow + 1
    const dimRow = serieRow + 2
    const sarjaRow = serieRow + 3
    const lungRow = serieRow + 4

    // Determină tevi pentru acest rand vizual
    // isRand1: 10 blocuri suduri (T_{pipeIdx}..T_{pipeIdx+9}), 9 țevi info sub blocuri 0..8
    // isRandN: 11 blocuri (wrap + 10 noi), 10 țevi info sub blocuri 0..9 (inclusiv wrap)
    const nrBlocuri = isRand1 ? 10 : 11
    const nrTeviInfo = isRand1 ? 9 : 10
    const teviRandStart = isRand1 ? pipeIdx : pipeIdx // wrap pe rand N>0 = pipes[pipeIdx] (= ultim bloc rand prev)

    for (let b = 0; b < nrBlocuri; b++) {
      const sudPipe = teviReale[teviRandStart + b]
      if (!sudPipe) {
        // Nu mai există țevi — clear cells pentru blocurile suplimentare din template
        const col = pozKmCols[b]
        if (col) {
          for (const r of [pozKmRow, sudRow]) {
            const a = `${col}${r}`
            if (ws[a]) ws[a].v = ''
          }
        }
        const serieCol = b < serieCols.length ? serieCols[b] : null
        if (serieCol) {
          for (const r of [serieRow, tipRow, dimRow, sarjaRow, lungRow]) {
            const a = `${serieCol}${r}`
            if (ws[a]) { ws[a].v = ''; ws[a].t = 's' }
          }
        }
        continue
      }

      const col_km = pozKmCols[b]
      // POZ KM value
      const kmAddr = `${col_km}${pozKmRow}`
      if (ws[kmAddr]) {
        const pozKmVal = formatPozKm(sudPipe._poz_km != null ? sudPipe._poz_km : sudPipe.poz_km_m)
        ws[kmAddr].v = pozKmVal
        ws[kmAddr].t = 's'
        delete ws[kmAddr].f
      }
      // SUDURA value
      const sudAddr = `${col_km}${sudRow}`
      if (ws[sudAddr]) {
        ws[sudAddr].v = formatSudura(sudPipe)
        ws[sudAddr].t = 's'
        delete ws[sudAddr].f
      }

      // SERIE/TIP/DIM/ȘARJĂ/LUNGIME (doar pentru blocurile cu teva info)
      if (b < nrTeviInfo) {
        const teva = sudPipe
        const col_serie = serieCols[b]
        if (col_serie) {
          const fields = [
            [`${col_serie}${serieRow}`, teva.serie_unica || '', 's'],
            [`${col_serie}${tipRow}`, teva.tip || '', 's'],
            [`${col_serie}${dimRow}`, teva.dimensiune || '', 's'],
            [`${col_serie}${sarjaRow}`, teva.sarja || '', 's'],
            [`${col_serie}${lungRow}`, teva.lungime_m != null ? Number(teva.lungime_m) : '', teva.lungime_m != null ? 'n' : 's'],
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
    }

    pipeIdx += nrTeviInfo // consumat țevile cu info (9 pe rand 1, 10 pe rand N — primul wrap)
  }

  // ========== 4. Lookup table BS14:BZ — generăm fresh (zeci de formule complexe in template) ==========
  const lookupHeaderStyle = {
    font: FONT_BOLD, fill: FILL_DARKER, alignment: ALIGN_CENTER_WRAP, border: BORDER_THIN,
  }
  setCell(ws, 'BS14', 'POZ.', lookupHeaderStyle)
  setCell(ws, 'BT14', 'SERIE\nUNICĂ DE\nIDENTIFICARE', lookupHeaderStyle)
  setCell(ws, 'BU14', 'TIP', lookupHeaderStyle)
  setCell(ws, 'BV14', 'DIMENSIUNE', lookupHeaderStyle)
  setCell(ws, 'BW14', 'ȘARJĂ', lookupHeaderStyle)
  setCell(ws, 'BX14', 'CANT.', lookupHeaderStyle)
  setCell(ws, 'BY14', 'POZ. KM', lookupHeaderStyle)
  setCell(ws, 'BZ14', 'SUDURĂ', lookupHeaderStyle)

  const dataStyle = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN }
  const dataNumStyle = { font: FONT_BASE, alignment: ALIGN_CENTER, border: BORDER_THIN, numFmt: '#,##0.00' }

  tevi.forEach((row, idx) => {
    const r = 17 + idx
    const poz = idx + 1
    setNumCell(ws, `BS${r}`, poz, { ...dataStyle, font: FONT_BOLD })
    setCell(ws, `BT${r}`, row.serie_unica || '', dataStyle)
    setCell(ws, `BU${r}`, row.tip || '', dataStyle)
    let dim = row.dimensiune || ''
    if (row.tip_rand === 'curba' && row.unghi_curba && !dim.includes(row.unghi_curba)) {
      dim = dim ? `${dim} ${row.unghi_curba}` : row.unghi_curba
    }
    setCell(ws, `BV${r}`, dim, dataStyle)
    setCell(ws, `BW${r}`, row.sarja || '', dataStyle)
    if (row.lungime_m != null && row.lungime_m !== '') {
      setNumCell(ws, `BX${r}`, row.lungime_m, dataNumStyle)
    } else {
      setCell(ws, `BX${r}`, '', dataStyle)
    }
    const pozKmVal = row._poz_km != null ? row._poz_km : row.poz_km_m
    setCell(ws, `BY${r}`, formatPozKm(pozKmVal), dataStyle)
    setCell(ws, `BZ${r}`, formatSudura(row), dataStyle)
  })

  // ========== 5. Set merges + row heights + col widths ==========
  ws['!merges'] = allMerges

  ws['!rows'] = []
  for (const [rIdx, h] of Object.entries(rowHeights)) {
    ws['!rows'][parseInt(rIdx, 10)] = { hpt: h }
  }

  ws['!cols'] = []
  for (const [cIdx, w] of Object.entries(TRANSGAZ_COL_WIDTHS)) {
    ws['!cols'][parseInt(cIdx, 10)] = { wch: w }
  }
  // Lookup table cols BS-BZ (70-77) — width-uri default proprii
  ws['!cols'][70] = { wch: 6 }
  ws['!cols'][71] = { wch: 16 }
  ws['!cols'][72] = { wch: 8 }
  ws['!cols'][73] = { wch: 14 }
  ws['!cols'][74] = { wch: 10 }
  ws['!cols'][75] = { wch: 9 }
  ws['!cols'][76] = { wch: 11 }
  ws['!cols'][77] = { wch: 11 }

  // ========== 6. Sheet range ==========
  const lastVisualRow = 17 + nrRanduriVizuale * 13
  const lastLookupRow = Math.max(17 + tevi.length - 1, 16)
  const lastRow = Math.max(lastVisualRow, lastLookupRow)
  ws['!ref'] = `A1:BZ${lastRow}`

  return ws
}

// ---------------------------------------------------------------------------
// MAIN: Generate workbook + return as Uint8Array (bytes)
// ---------------------------------------------------------------------------
export function generateCentralizatorXlsx({ pachet, tronson, proiect, tevi }) {
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
  return new Uint8Array(out)
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
