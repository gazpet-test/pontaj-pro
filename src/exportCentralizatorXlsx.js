// ===========================================================================
// EXPORT CENTRALIZATOR TRANSGAZ - Sub-faza E V1 (21.05.2026)
// ---------------------------------------------------------------------------
//   • Sheet 1 CENTRALIZATOR — pixel-perfect cu modelul Transgaz (Segoe UI 10pt,
//     header zone fill grey, cap tabel grey D9, borders thin, merged cells)
//   • Sheet 2 IZOMETRIE — V1 MINIMAL: header zone + lookup table BS17:BZ
//     (schema vizuala cu blocuri 1:1 vine in V2 dupa decoded pattern wrap)
//
// Input: { pachet, tronson, proiect, tevi } - obiecte direct din BD
// Output: Uint8Array - bytes xlsx pentru blob/download/upload Storage
// ===========================================================================

import * as XLSX_mod from 'xlsx-js-style'
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
// BUILD SHEET 2 — IZOMETRIE V1 (minimal: header + lookup table BS17:BZ)
// V2 va adauga schema vizuala cu blocuri 1:1 dupa decoded pattern wrap
// ---------------------------------------------------------------------------
function buildSheet2IzometrieMinimal({ pachet, tronson, proiect, tevi }) {
  const ws = {}

  // ========== HEADER ZONE R1-R10 (identic cu sheet 1) ==========
  setCell(ws, 'B2', 'S.N.T.G.N. TRANSGAZ S.A.', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  setCell(ws, 'B3', 'UNITATEA DE IMPLEMENTARE SI MANAGEMENT PROIECTE', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  setCell(ws, 'B4', 'SERVICIUL LOGISTICĂ ȘI SUPORT EXECUȚIE', {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_LEFT,
  })
  const conducta = proiect?.nume_complet || proiect?.nume || 'CONDUCTĂ DE TRANSPORT GAZE NATURALE'
  setCell(ws, 'B6', conducta, {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_CENTER, border: BORDER_LR_THIN,
  })
  // R8: SCHEMĂ DE MONTAJ ... + cod document (in sheet 2 era formula =&CENTRALIZATOR!N14, aici string direct)
  const codDoc = pachet.cod_document_full + (pachet.revizie > 0 ? ` rev.${pachet.revizie}` : '')
  setCell(ws, 'B8', `SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE ${codDoc}`, {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_CENTER, border: BORDER_LR_THIN,
  })
  // R10: SENS CURGERE GAZ (din model col H)
  setCell(ws, 'H10', 'SENS CURGERE GAZ', {
    font: FONT_BOLD, alignment: ALIGN_CENTER,
  })

  // ========== LOOKUP TABLE BS14:BZ (header R14, date R17+) ==========
  // R14: header lookup table (POZ./SERIE/TIP/DIMENSIUNE/ȘARJĂ/CANT./POZ.KM/SUDURĂ)
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

  // Date lookup table starting at R17
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

  // ========== PLACEHOLDER pentru schema vizuala (V2) ==========
  // O nota in zona stanga pentru a marca ca aici vine schema vizuala in V2
  setCell(ws, 'B14', '⚠ Schema izometrica vizuala — disponibila in V2', {
    font: { ...FONT_BASE, italic: true, color: { rgb: '888888' } },
    alignment: ALIGN_LEFT,
  })
  setCell(ws, 'B15', 'Datele complete sunt in tabelul de referinta (coloanele BS-BZ →)', {
    font: { ...FONT_BASE, italic: true, color: { rgb: '888888' } },
    alignment: ALIGN_LEFT,
  })

  // ========== MERGED CELLS (header zone) ==========
  ws['!merges'] = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 13 } },   // B2:N2
    { s: { r: 2, c: 1 }, e: { r: 2, c: 13 } },   // B3:N3
    { s: { r: 3, c: 1 }, e: { r: 3, c: 13 } },   // B4:N4
    { s: { r: 5, c: 1 }, e: { r: 5, c: 18 } },   // B6:S6
    { s: { r: 7, c: 1 }, e: { r: 7, c: 7 } },    // B8:H8
    { s: { r: 9, c: 7 }, e: { r: 9, c: 12 } },   // H10:M10 (SENS CURGERE)
    // Lookup table header merged 3 rows (BS14:BS16 etc)
    { s: { r: 13, c: 70 }, e: { r: 15, c: 70 } }, // BS14:BS16
    { s: { r: 13, c: 71 }, e: { r: 15, c: 71 } }, // BT14:BT16
    { s: { r: 13, c: 72 }, e: { r: 15, c: 72 } }, // BU14:BU16
    { s: { r: 13, c: 73 }, e: { r: 15, c: 73 } }, // BV14:BV16
    { s: { r: 13, c: 74 }, e: { r: 15, c: 74 } }, // BW14:BW16
    { s: { r: 13, c: 75 }, e: { r: 15, c: 75 } }, // BX14:BX16
    { s: { r: 13, c: 76 }, e: { r: 15, c: 76 } }, // BY14:BY16
    { s: { r: 13, c: 77 }, e: { r: 15, c: 77 } }, // BZ14:BZ16
  ]

  // ========== COLUMN WIDTHS (lookup table cols) ==========
  ws['!cols'] = []
  // Cols B-G (placeholder zone, minimal)
  for (let i = 0; i < 70; i++) {
    ws['!cols'][i] = { wch: 3 } // ingust
  }
  // Lookup table cols BS-BZ (70-77)
  ws['!cols'][70] = { wch: 6 }   // BS: POZ
  ws['!cols'][71] = { wch: 16 }  // BT: SERIE
  ws['!cols'][72] = { wch: 8 }   // BU: TIP
  ws['!cols'][73] = { wch: 14 }  // BV: DIMENSIUNE
  ws['!cols'][74] = { wch: 10 }  // BW: ȘARJĂ
  ws['!cols'][75] = { wch: 9 }   // BX: CANT
  ws['!cols'][76] = { wch: 11 }  // BY: POZ KM
  ws['!cols'][77] = { wch: 11 }  // BZ: SUDURĂ

  // ========== SHEET RANGE ==========
  const lastLookupRow = Math.max(17 + tevi.length - 1, 16)
  ws['!ref'] = `A1:BZ${lastLookupRow}`

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
  const ws2 = buildSheet2IzometrieMinimal({ pachet, tronson, proiect, tevi: teviWithPozKm })

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
