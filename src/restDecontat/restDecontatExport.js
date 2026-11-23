// Execuție → „💰 Rest de decontat”: exportul Excel (xlsx-js-style, deja în proiect). Rândurile vin calculate din vederile 20270105a (L19);
// aici doar se așază: foaia pe articol (bani + cantități), foaia pe obiect (doar bani), lipsurile și foaia „Despre” (praguri, ce înseamnă).
// Ajustările de preț din situațiile de plată apar separat (nu intră în rest, nici în cantități).
import * as XLSX_mod from 'xlsx-js-style'
import { ordoneazaArticole, etichetaLipsa, PRAG_PROIECT_AVANSAT_PCT, PRAG_ARTICOL_SUB_PCT } from './tabLogica.js'
const XLSX = XLSX_mod.default || XLSX_mod

const BORDURA = { top: { style: 'thin', color: { rgb: 'BFBFBF' } }, bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
  left: { style: 'thin', color: { rgb: 'BFBFBF' } }, right: { style: 'thin', color: { rgb: 'BFBFBF' } } }
const ANTET = { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1F5FA8' } },
  alignment: { vertical: 'center', wrapText: true }, border: BORDURA }
const CELULA = { font: { name: 'Calibri', sz: 11 }, border: BORDURA }
const ROSU = { ...CELULA, fill: { patternType: 'solid', fgColor: { rgb: 'F8CBAD' } } }
const nr = v => (v == null || v === '' ? '' : Number(v))

export const CAP_ARTICOLE = ['Obiect', 'Deviz', 'Nr', 'Cod', 'Denumire', 'UM', 'Tip', 'Cantitate bază', 'Cantitate decontată', 'Rest cantitate',
  'Preț unitar', 'Valoare bază', 'Valoare decontată', 'Rest valoare', '% decontat', 'Peste ofertă', 'Nedecontat deloc', 'UM incert', 'Situații', 'Ultima situație']
export const randuriArticole = articole => ordoneazaArticole(articole).map(a => [
  a.obiect_cod || '', a.deviz_cod || '', a.nr || '', a.cod || '', a.denumire || '', a.um || '',
  a.cheie ? (a.tip_rand || 'articol') : `${a.tip_rand || 'articol_nou'} (în afara ofertei)`,
  nr(a.baza_cantitate), nr(a.decontat_cantitate), nr(a.rest_cantitate), nr(a.pret_unitar), nr(a.baza_valoare), nr(a.decontat_valoare), nr(a.rest_valoare),
  nr(a.pct_decontat), a.peste_oferta ? 'da' : '', a.nedecontat ? 'da' : '', a.um_incert ? 'da' : '', nr(a.situatii), a.ultima_situatie || '',
])
export const CAP_OBIECTE = ['Nivel', 'Obiect', 'Nume', 'Valoare bază', 'Valoare decontată', 'Rest valoare', '% decontat', 'Articole', 'Nedecontate deloc', 'Peste ofertă', 'Articole noi']
export const randuriObiecte = obiecte => [...(obiecte || [])].sort((a, b) => (a.nivel === 'proiect') - (b.nivel === 'proiect') || String(a.obiect_cod ?? '').localeCompare(String(b.obiect_cod ?? ''), 'ro', { numeric: true }))
  .map(o => [o.nivel === 'proiect' ? 'TOTAL PROIECT' : 'obiect', o.obiect_cod || '', o.obiect_nume || '', nr(o.baza_valoare), nr(o.decontat_valoare), nr(o.rest_valoare),
    nr(o.pct_decontat), nr(o.articole), nr(o.articole_nedecontate), nr(o.articole_peste), nr(o.articole_noi)])

function foaie(rows, latimi, stil) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  rows.forEach((row, r) => row.forEach((_, c) => {
    const a = XLSX.utils.encode_cell({ r, c })
    if (!ws[a]) ws[a] = { t: 's', v: '' }
    ws[a].s = r === 0 ? ANTET : (stil ? stil(r, c) : CELULA)
  }))
  ws['!cols'] = latimi.map(w => ({ wch: w }))
  ws['!rows'] = [{ hpt: 32 }]
  if (rows.length > 1) ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}` }
  return ws
}

/** Fișierul .xlsx (Uint8Array). */
export function construiesteExportRest({ articole, obiecte, lipsuri, ajustari, proiect, generatLa }) {
  const ord = ordoneazaArticole(articole)
  const rA = [CAP_ARTICOLE, ...randuriArticole(ord)]
  const wsA = foaie(rA, [10, 10, 6, 12, 50, 8, 18, 13, 13, 13, 12, 14, 14, 14, 10, 10, 10, 9, 9, 12],
    (r, c) => (ord[r - 1]?.peste_oferta && (c === 9 || c === 13) ? ROSU : CELULA))
  const wsO = foaie([CAP_OBIECTE, ...randuriObiecte(obiecte)], [14, 12, 40, 15, 15, 15, 10, 9, 10, 10, 10])
  const wsL = foaie([['Lipsă', 'Referință'], ...(lipsuri || []).map(l => [etichetaLipsa(l.tip), l.referinta || ''])], [60, 70])
  const info = [['Ce', 'Valoare'],
    ['Proiect', proiect ? `${proiect.cod_intern || ''} ${proiect.nume || ''}`.trim() : ''],
    ['Bază', 'oferta financiară (contractul inițial) + devizele actelor adiționale + notele NR / NCS aprobate și nepreluate de un act adițional; prețul = al ultimului act care l-a dat'],
    ['Decontat', 'suma cantităților din situațiile de plată detaliate ACTIVE (o singură versiune pe număr de situație), cu semn; UM-uri convertite prin factor (HM = 100 m, 100 MC = 100 mc)'],
    ['Rest', 'bază − decontat; negativ = peste ofertă (se semnalează, nu se taie la zero)'],
    ['Cantități', 'doar pe articol; pe obiect și pe proiect doar bani'],
    ['Ajustări de preț', ajustari == null ? 'necitite' : `${ajustari} lei din situațiile de plată — informativ, nu intră în rest și nici în cantități`],
    ['Semnal de risc', `articole nedecontate deloc sau sub ${PRAG_ARTICOL_SUB_PCT}% când proiectul a trecut de ${PRAG_PROIECT_AVANSAT_PCT}% din valoarea de bază decontată`],
    ['Exportat la', generatLa || ''],
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsA, 'Pe articol')
  XLSX.utils.book_append_sheet(wb, wsO, 'Pe obiect')
  XLSX.utils.book_append_sheet(wb, wsL, 'Lipsuri')
  XLSX.utils.book_append_sheet(wb, foaie(info, [22, 120]), 'Despre')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
}

export const numeFisierRest = (cod, azi) => `Rest_de_decontat_${String(cod || 'proiect').replace(/[^A-Za-z0-9_-]+/g, '_')}_${String(azi).split('-').reverse().join('.')}.xlsx`
