// ===========================================================================
// EXPORT CENTRALIZATOR TRANSGAZ - Sub-faza E V2 (21.05.2026)
// ---------------------------------------------------------------------------
//   • Sheet 1 CENTRALIZATOR — pixel-perfect cu modelul Transgaz (Segoe UI 10pt,
//     header zone fill grey, cap tabel grey D9, borders thin, merged cells)
//   • Sheet 2 IZOMETRIE — V2 schema vizuala cu blocuri 6-col/teava:
//     - Header zone identic cu sheet 1 + SENS CURGERE GAZ
//     - Blocuri 6 cols/teava, 10 blocuri/rand vizual, 9 tevi/rand
//     - Style Segoe UI 8pt bold, border medium pe blocurile POZ.KM/SUDURĂ
//     - Lookup table BS17:BZ pastrat
//     - V2 MVP: toate randurile incep la col H (skip wrap col B - decorativ)
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
// BUILD SHEET 2 — IZOMETRIE V2 (schema vizuala cu blocuri 6-col per teava)
// ---------------------------------------------------------------------------
// LAYOUT:
//   - Header zone R1-R10 identic cu sheet 1 + SENS CURGERE GAZ
//   - Schema vizuala: blocuri orizontale 6 cols/teava, ~10 tevi/rand vizual
//   - Rand 1: R17-R25 (cols H-BO, 10 blocuri = 10 suduri + 9 tevi)
//   - Rand N: R(17+13*N)-R(25+13*N), col H, 10 blocuri (wrap col B-G omis MVP)
//   - Style: Segoe UI 8pt bold, border medium pe POZ.KM/SUDURĂ box,
//            SERIE/TIP/DIM/ȘARJĂ/LUNGIME fara border, text aliniat
//   - Lookup table BS17:BZ pentru consistenta cu modelul Transgaz
//   - Skip: curbe/legaturi/separatoare (apar doar in sheet 1 + lookup)
// ---------------------------------------------------------------------------

const BLOC_COLS = 6 // fiecare bloc = 6 coloane (3 label + 3 valoare)
const BLOCURI_PER_RAND = 10 // 10 suduri per rand vizual → 9 tevi cu wrap conectiune
const RAND_VIZUAL_HEIGHT = 13 // 13 randuri Excel intre randurile vizuale
const COL_START_RAND1 = 8 // col H = bloc start pe rand 1
const ROW_START_RAND1 = 17

// Style helpers pentru blocuri sheet 2 (Segoe UI 8pt bold)
const FONT_BLOC = { name: 'Segoe UI', sz: 8, bold: true, color: { rgb: '000000' } }
const FILL_WHITE = { patternType: 'solid', fgColor: { rgb: 'FFFFFF' } }

const BORDER_BLOC_POZ_KM = { // capac sus + lateral pe POZ.KM. row
  left: { style: 'medium', color: { rgb: '000000' } },
  right: { style: 'medium', color: { rgb: '000000' } },
  top: { style: 'medium', color: { rgb: '000000' } },
}
const BORDER_BLOC_SUD = { // capac jos + lateral pe SUDURĂ row
  left: { style: 'medium', color: { rgb: '000000' } },
  right: { style: 'medium', color: { rgb: '000000' } },
  bottom: { style: 'medium', color: { rgb: '000000' } },
}
const BORDER_LABEL_R_MEDIUM = { // label cells au R medium (separa de value)
  right: { style: 'medium', color: { rgb: '000000' } },
}

const ALIGN_BLOC_LABEL = { horizontal: 'right', vertical: 'center' }
const ALIGN_BLOC_VAL = { horizontal: 'left', vertical: 'center' }

// ---------------------------------------------------------------------------
// Render un BLOC complet (un sudura + (optional) teava info dedesubt)
// ---------------------------------------------------------------------------
function renderBlock(ws, rowBase, colBase, sudData, tevaData, merges) {
  // R(rowBase) POZ.KM.
  // - col 1-3: label "POZ. KM." (merged)
  // - col 4-6: valoare KM (merged)
  const labelKM_addr = cellAddr(rowBase, colBase)
  const valKM_addr = cellAddr(rowBase, colBase + 3)

  setCell(ws, labelKM_addr, 'POZ. KM.', {
    font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_LABEL, border: BORDER_LABEL_R_MEDIUM,
  })
  setCell(ws, valKM_addr, sudData?.poz_km_str || '', {
    font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_VAL, border: BORDER_BLOC_POZ_KM,
  })

  // R(rowBase+1) SUDURĂ
  const labelSud_addr = cellAddr(rowBase + 1, colBase)
  const valSud_addr = cellAddr(rowBase + 1, colBase + 3)

  setCell(ws, labelSud_addr, 'SUDURĂ :', {
    font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_LABEL, border: BORDER_LABEL_R_MEDIUM,
  })
  setCell(ws, valSud_addr, sudData?.sudura_cod || '', {
    font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_VAL, border: BORDER_BLOC_SUD,
  })

  // Merge label + value (3 cols each)
  merges.push({ s: { r: rowBase - 1, c: colBase - 1 }, e: { r: rowBase - 1, c: colBase + 1 } })
  merges.push({ s: { r: rowBase - 1, c: colBase + 2 }, e: { r: rowBase - 1, c: colBase + 4 } })
  merges.push({ s: { r: rowBase, c: colBase - 1 }, e: { r: rowBase, c: colBase + 1 } })
  merges.push({ s: { r: rowBase, c: colBase + 2 }, e: { r: rowBase, c: colBase + 4 } })

  // R(rowBase+4..+8) ȚEAVA info — afișată ÎNTRE blocul curent și cel următor
  // Label la col (colBase + 5) = ultim col bloc curent
  // Value la col (colBase + 6) = primul col bloc URMĂTOR
  if (tevaData) {
    const labelCol = colBase + 5
    const valCol = colBase + 6
    const tevaRows = [
      { row: rowBase + 4, label: 'SERIE :', val: tevaData.serie_unica },
      { row: rowBase + 5, label: 'TIP :', val: tevaData.tip },
      { row: rowBase + 6, label: 'DIMENSIUNE :', val: tevaData.dimensiune },
      { row: rowBase + 7, label: 'ȘARJĂ :', val: tevaData.sarja },
      { row: rowBase + 8, label: 'LUNGIME :', val: tevaData.lungime_m },
    ]
    for (const tr of tevaRows) {
      const labelStyle = { font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_LABEL }
      const valStyle = { font: FONT_BLOC, fill: FILL_WHITE, alignment: ALIGN_BLOC_VAL }
      setCell(ws, cellAddr(tr.row, labelCol), tr.label, labelStyle)
      if (typeof tr.val === 'number') {
        setNumCell(ws, cellAddr(tr.row, valCol), tr.val, valStyle)
      } else {
        setCell(ws, cellAddr(tr.row, valCol), tr.val || '', valStyle)
      }
    }
  }
}

// Helper: row/col 1-indexed → "A1" address
function cellAddr(row, col) {
  let colStr = ''
  let c = col
  while (c > 0) {
    const rem = (c - 1) % 26
    colStr = String.fromCharCode(65 + rem) + colStr
    c = Math.floor((c - 1) / 26)
  }
  return `${colStr}${row}`
}

function buildSheet2IzometrieFull({ pachet, tronson, proiect, tevi }) {
  const ws = {}
  const merges = []

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
  const codDoc = pachet.cod_document_full + (pachet.revizie > 0 ? ` rev.${pachet.revizie}` : '')
  setCell(ws, 'B8', `SCHEMĂ DE MONTAJ ÎNAINTE DE LANSARE ${codDoc}`, {
    font: FONT_BOLD, fill: FILL_LIGHT, alignment: ALIGN_CENTER, border: BORDER_LR_THIN,
  })
  // SENS CURGERE GAZ
  setCell(ws, 'H10', 'SENS CURGERE GAZ →', {
    font: { ...FONT_BOLD, sz: 9 }, alignment: ALIGN_CENTER,
  })

  // ========== SCHEMA VIZUALA — blocuri 6 cols ==========
  // Filtrez tevi REALE (NU curbe/legari/separatoare) pentru schema vizuala
  // Curbele apar doar in sheet 1 + lookup table
  const teviReale = tevi.filter(t => t.tip_rand === 'teava')
  const nrTeviReale = teviReale.length

  // Calc numar randuri vizuale: rand 1 are 9 tevi (10 suduri delimiteaza 9 tevi),
  // randurile 2+ au tot 9 tevi noi fiecare. Conexiunea: ultima sudura rand N = prima sudura rand N+1.
  const TEVI_PER_RAND_VIZUAL = 9
  const nrRanduriVizuale = Math.max(1, Math.ceil(nrTeviReale / TEVI_PER_RAND_VIZUAL))

  let tevaIdx = 0
  for (let randIdx = 0; randIdx < nrRanduriVizuale; randIdx++) {
    const rowBase = ROW_START_RAND1 + randIdx * RAND_VIZUAL_HEIGHT
    const colBase = COL_START_RAND1 // toate randurile incep la col H (MVP — wrap col B in V3)

    // Pentru fiecare bloc din rand: 10 blocuri total
    // - Bloc 0: sudura "start" (intrare in rand)
    // - Blocuri 1-9: sudura + teava precedenta
    for (let blocIdx = 0; blocIdx < BLOCURI_PER_RAND; blocIdx++) {
      const blocColBase = colBase + blocIdx * BLOC_COLS

      // Teava ASOCIATA cu blocul = teava de DUPA sudura (sub bloc curent → in bloc URMATOR)
      // Excepție: la blocul ultim, nu mai e teava de afișat
      let sudData = null
      let tevaData = null

      // Pe rand N, primul bloc e wrap conexiune cu randul N-1
      if (randIdx > 0 && blocIdx === 0) {
        // Sudura de la sfârșitul randului anterior (= ultima teava prev)
        const lastTevaPrev = teviReale[tevaIdx - 1]
        if (lastTevaPrev) {
          sudData = {
            poz_km_str: formatPozKm(lastTevaPrev._poz_km != null ? lastTevaPrev._poz_km + (Number(lastTevaPrev.lungime_m) || 0) : null),
            sudura_cod: formatSudura(lastTevaPrev),
          }
        }
      } else {
        // Bloc normal — sudura curenta
        const currTeava = teviReale[tevaIdx]
        if (currTeava) {
          sudData = {
            poz_km_str: formatPozKm(currTeava._poz_km != null ? currTeava._poz_km : currTeava.poz_km_m),
            sudura_cod: formatSudura(currTeava),
          }
          // Teava care vine DUPĂ sudura (afisata in dreapta blocului curent)
          // Va fi teava urmatoare daca nu suntem la ultim bloc
          if (blocIdx < BLOCURI_PER_RAND - 1) {
            tevaData = currTeava
            tevaIdx++
          }
        }
      }

      // Doar dacă avem măcar sudData, renderez blocul
      if (sudData) {
        renderBlock(ws, rowBase, blocColBase, sudData, tevaData, merges)
      }
    }
  }

  // ========== LOOKUP TABLE BS14:BZ — pentru consistenta cu modelul ==========
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

  // ========== MERGED CELLS HEADER ZONE + LOOKUP ==========
  const headerMerges = [
    { s: { r: 1, c: 1 }, e: { r: 1, c: 13 } },   // B2:N2
    { s: { r: 2, c: 1 }, e: { r: 2, c: 13 } },   // B3:N3
    { s: { r: 3, c: 1 }, e: { r: 3, c: 13 } },   // B4:N4
    { s: { r: 5, c: 1 }, e: { r: 5, c: 67 } },   // B6:BO6 (full width)
    { s: { r: 7, c: 1 }, e: { r: 7, c: 67 } },   // B8:BO8
    // Lookup table header merged 3 rows
    { s: { r: 13, c: 70 }, e: { r: 15, c: 70 } }, // BS14:BS16
    { s: { r: 13, c: 71 }, e: { r: 15, c: 71 } }, // BT14:BT16
    { s: { r: 13, c: 72 }, e: { r: 15, c: 72 } }, // BU14:BU16
    { s: { r: 13, c: 73 }, e: { r: 15, c: 73 } }, // BV14:BV16
    { s: { r: 13, c: 74 }, e: { r: 15, c: 74 } }, // BW14:BW16
    { s: { r: 13, c: 75 }, e: { r: 15, c: 75 } }, // BX14:BX16
    { s: { r: 13, c: 76 }, e: { r: 15, c: 76 } }, // BY14:BY16
    { s: { r: 13, c: 77 }, e: { r: 15, c: 77 } }, // BZ14:BZ16
  ]
  ws['!merges'] = [...headerMerges, ...merges]

  // ========== COLUMN WIDTHS — pattern repetitiv 6-col blocuri ==========
  ws['!cols'] = []
  // Cols A-G placeholder
  ws['!cols'][0] = { wch: 3 }    // A
  ws['!cols'][1] = { wch: 4.86 } // B
  ws['!cols'][2] = { wch: 2.71 } // C
  ws['!cols'][3] = { wch: 1.71 } // D
  ws['!cols'][4] = { wch: 3 }    // E
  ws['!cols'][5] = { wch: 2.71 } // F
  ws['!cols'][6] = { wch: 12.71 }// G
  // Blocuri H-BO: pattern 6-col repetat de 10 ori
  // Per bloc: [default, 2.71, 1.71, default, 2.71, 12.71]
  const blocPattern = [8.43, 2.71, 1.71, 8.43, 2.71, 12.71]
  for (let i = 0; i < BLOCURI_PER_RAND; i++) {
    for (let j = 0; j < BLOC_COLS; j++) {
      ws['!cols'][COL_START_RAND1 - 1 + i * BLOC_COLS + j] = { wch: blocPattern[j] }
    }
  }
  // Lookup table cols BS-BZ (70-77)
  ws['!cols'][70] = { wch: 6 }    // BS
  ws['!cols'][71] = { wch: 16 }   // BT
  ws['!cols'][72] = { wch: 8 }    // BU
  ws['!cols'][73] = { wch: 14 }   // BV
  ws['!cols'][74] = { wch: 10 }   // BW
  ws['!cols'][75] = { wch: 9 }    // BX
  ws['!cols'][76] = { wch: 11 }   // BY
  ws['!cols'][77] = { wch: 11 }   // BZ

  // ========== ROW HEIGHTS — compact pe randurile mici ale blocurilor ==========
  ws['!rows'] = []
  for (let randIdx = 0; randIdx < nrRanduriVizuale; randIdx++) {
    const rowBase = ROW_START_RAND1 + randIdx * RAND_VIZUAL_HEIGHT
    // R(rowBase+1) SUDURĂ row, R(rowBase+2,+3) gol, R(rowBase+8) LUNGIME row, R(rowBase+9) gol = compact 11.25pt
    ws['!rows'][rowBase] = { hpt: 11.25 }     // SUDURĂ row (rowBase+1 in 1-indexed)
    ws['!rows'][rowBase + 1] = { hpt: 11.25 }
    ws['!rows'][rowBase + 2] = { hpt: 11.25 }
    ws['!rows'][rowBase + 7] = { hpt: 11.25 } // LUNGIME row (rowBase+8 in 1-indexed → -1 = +7)
    ws['!rows'][rowBase + 8] = { hpt: 11.25 }
    ws['!rows'][rowBase + 11] = { hpt: 11.25 } // separator before next bloc
  }

  // ========== SHEET RANGE ==========
  const lastSchemaRow = ROW_START_RAND1 + nrRanduriVizuale * RAND_VIZUAL_HEIGHT
  const lastLookupRow = Math.max(17 + tevi.length - 1, 16)
  const lastRow = Math.max(lastSchemaRow, lastLookupRow)
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
  const ws2 = buildSheet2IzometrieFull({ pachet, tronson, proiect, tevi: teviWithPozKm })

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
