// Coloanele de totaluri din exporturile de pontaj (ReportsPage): Pontaj BRUT (exportPontajBrut) și foaia colectivă NET
// (generatePontajNet). O singură listă de norme numărate pe zile + o singură socoteală a pozițiilor, ca toate
// coloanele de după norme (ORE NORME, TOTAL ORE LUNĂ, ORE LUCRĂTOARE, „Zile lucr. lună:”) să se mute împreună.
// TKT-2026-0311: ZILE CO / CM / CFP / O. TKT-2026-0368 (partea A): ZILE BO (boală obișnuită) imediat după ZILE CM.
// TKT-2026-0368 (partea B): ZILE IP (Învoiri Plătite) imediat după ZILE O; CM și O rămân pentru lunile vechi.
// Ordinea din listă = ordinea coloanelor din Excel.
import * as XLSX from 'xlsx-js-style'

export const NORME_TOTAL_EXPORT = ['CO', 'CM', 'BO', 'CFP', 'O', 'IP']

const FIXED = 3 // A = Nume, B = Funcția, C = Program de lucru; zilele încep în D

// Pontaj BRUT: … zile | TOTAL ZILE | TOTAL ORE | ORE SUPLIMENTARE | ZILE <norme> | ORE NORME | TOTAL ORE LUNĂ | ORE LUCRĂTOARE | „Zile lucr. lună:” | valoare
export function coloaneBrut(days) {
  const TOTAL_ZILE_C = FIXED + days
  const TOTAL_ORE_C = TOTAL_ZILE_C + 1
  const ORE_SUPL_C = TOTAL_ORE_C + 1
  const NORME_C0 = ORE_SUPL_C + 1
  const ORE_NORME_C = NORME_C0 + NORME_TOTAL_EXPORT.length
  const TOTAL_LUNA_C = ORE_NORME_C + 1
  const ORE_LUCR_C = TOTAL_LUNA_C + 1
  const WD_LABEL_C = ORE_LUCR_C + 1
  const WD_VALUE_C = WD_LABEL_C + 1
  return { FIXED, TOTAL_ZILE_C, TOTAL_ORE_C, ORE_SUPL_C, NORME_C0, ORE_NORME_C, TOTAL_LUNA_C, ORE_LUCR_C, WD_LABEL_C, WD_VALUE_C }
}

// NET: … zile | TOTAL ZILE | TOTAL ORE | ZILE <norme> | „Zile lucr. lună:” | valoare (fără ORE SUPL)
export function coloaneNet(days) {
  const TOTAL_ZILE_C = FIXED + days
  const TOTAL_ORE_C = TOTAL_ZILE_C + 1
  const NORME_C0 = TOTAL_ORE_C + 1
  const WD_LABEL_C = NORME_C0 + NORME_TOTAL_EXPORT.length
  const WD_VALUE_C = WD_LABEL_C + 1
  const DATA_COL_END = FIXED + days - 1
  return { FIXED, TOTAL_ZILE_C, TOTAL_ORE_C, NORME_C0, WD_LABEL_C, WD_VALUE_C, DATA_COL_END }
}

// Antetul coloanelor de după zile (rândul 6) + rândul 7 de sub antet
export function antetTotaluriBrut(labels, normeOre) {
  return {
    hdr: ['TOTAL ZILE', 'TOTAL ORE', 'ORE SUPLIMENTARE', ...NORME_TOTAL_EXPORT.map(n => `ZILE ${n}`), 'ORE NORME (h normă/zi)', 'TOTAL ORE LUNĂ', 'ORE LUCRĂTOARE'],
    dnr: ['', '', '', ...NORME_TOTAL_EXPORT.map(n => labels[n] || n), `h normă × zile ${normeOre.join('/')}`, 'ORE + ORE NORME', 'normă × zile în contract'],
  }
}

export function antetTotaluriNet(labels) {
  return {
    hdr: ['TOTAL ZILE', 'TOTAL ORE', ...NORME_TOTAL_EXPORT.map(n => `ZILE ${n}`)],
    dnr: ['', '', ...NORME_TOTAL_EXPORT.map(n => labels[n] || n)],
  }
}

// Numărarea pe angajat în BRUT: zile pe fiecare normă din NORME_TOTAL_EXPORT + zilele cu normă plătită (normeOre).
// normeZile = codurile de normă ale zilelor lunii (null / '' = zi fără normă).
export function numaraNorme(normeZile, normeOre) {
  const normeCnt = Object.fromEntries(NORME_TOTAL_EXPORT.map(n => [n, 0]))
  let zileNormeOre = 0
  for (const n of normeZile) {
    if (!n) continue
    if (normeCnt[n] !== undefined) normeCnt[n]++
    if (normeOre.includes(n)) zileNormeOre++
  }
  return { normeCnt, zileNormeOre }
}

// Celulele de după zile pe rândul „Ora Intrare” (BRUT); excelRow = rândul Excel (1-indexat) al angajatului
export function totaluriBrutIntrare({ days, excelRow, totalZile, totalOre, normeCnt, oreNorme, oreLucratoare }) {
  const c = coloaneBrut(days)
  const L = XLSX.utils.encode_col
  return [
    totalZile,
    totalOre,
    // ORE SUPLIMENTARE (TKT-2026-0316) = MAX(0, TOTAL ORE LUNĂ − ORE LUCRĂTOARE)
    { f: `MAX(0, ${L(c.TOTAL_LUNA_C)}${excelRow} - ${L(c.ORE_LUCR_C)}${excelRow})`, t: 'n' },
    // 0 explicit când nu există, ca să se poată însuma
    ...NORME_TOTAL_EXPORT.map(n => normeCnt[n]),
    oreNorme,
    // TOTAL ORE LUNĂ = TOTAL ORE + ORE NORME
    { f: `${L(c.TOTAL_ORE_C)}${excelRow}+${L(c.ORE_NORME_C)}${excelRow}`, t: 'n' },
    oreLucratoare,
  ]
}

// Celulele de după zile pe rândul „Ora Intrare” (NET): formule pe rândul Ore Lucrate (r+3) și pe codurile de normă (r)
export function totaluriNetIntrare({ days, excelRow }) {
  const { FIXED: F, DATA_COL_END } = coloaneNet(days)
  const d0 = XLSX.utils.encode_col(F)
  const dN = XLSX.utils.encode_col(DATA_COL_END)
  return [
    { f: `COUNTIF(${d0}${excelRow + 3}:${dN}${excelRow + 3},">0")`, t: 'n' },
    { f: `SUM(${d0}${excelRow + 3}:${dN}${excelRow + 3})`, t: 'n' },
    ...NORME_TOTAL_EXPORT.map(n => ({ f: `COUNTIF(${d0}${excelRow}:${dN}${excelRow},"${n}")`, t: 'n' })),
  ]
}
