// Execuție → „📋 Deviz vs executat”: exportul Excel al rândurilor din v_executie_tinte (20261208a). Valorile și alertele vin calculate
// din vedere (L19); aici doar se așază. Pragurile din foaia „Despre” sunt cele de pe rândurile exportate, nu cele din pagină.
import * as XLSX_mod from 'xlsx-js-style'
import { ordoneaza, metadateTinte, alerta, numeUnitate } from './devizTinte.js'
const XLSX = XLSX_mod.default || XLSX_mod

const BORDURA = { top: { style: 'thin', color: { rgb: 'BFBFBF' } }, bottom: { style: 'thin', color: { rgb: 'BFBFBF' } },
  left: { style: 'thin', color: { rgb: 'BFBFBF' } }, right: { style: 'thin', color: { rgb: 'BFBFBF' } } }
const ANTET = { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1F5FA8' } },
  alignment: { vertical: 'center', wrapText: true }, border: BORDURA }
const CELULA = { font: { name: 'Calibri', sz: 11 }, border: BORDURA }
const ALERTA = { ...CELULA, fill: { patternType: 'solid', fgColor: { rgb: 'F8CBAD' } } }
const nr = v => (v == null || v === '' ? '' : Number(v))
const data = v => (v ? String(v).slice(0, 10).split('-').reverse().join('.') : '')

export const CAP_EXPORT = ['Obiect', 'Cod obiect (deviz)', 'Nod', 'Activitate', 'UM', 'Principală', 'Bază deviz', 'Factor UM', 'Articole',
  'Din deviz', 'Executat', 'Sursa executat', 'Rest', 'Peste deviz', '% executat', '% planificat', 'Plan start', 'Plan final',
  'Ultima raportare', 'Alerte']

export function randuriExport(tinte) {
  return ordoneaza(tinte).map(t => [
    t.unitate_id == null ? '— fără obiect —' : numeUnitate({ cod: t.unitate_cod, nume: t.unitate_nume }),
    t.obiect_cod || '', t.nod_cod || '',
    t.activitate_id == null ? '— suduri fără activitate (DN) —' : (t.activitate_nume || ''),
    t.um || '', t.activitate_id == null ? '' : (t.principala ? 'da' : 'nu'),
    t.activitate_id == null ? '' : (t.baza_deviz === 'oferta' ? 'ofertă' : 'revizuită'), nr(t.factor_um), nr(t.articole),
    nr(t.din_deviz), nr(t.executat), t.executat_sursa === 'schema_nod' ? 'schema nodului' : 'raport zilnic',
    nr(t.rest), nr(t.peste_deviz), nr(t.pct_executat), nr(t.pct_plan), data(t.plan_start), data(t.plan_final), data(t.ultima_raportare),
    (t.alerte || []).map(c => alerta(c).eticheta).join(', '),
  ])
}

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

/** Fișierul .xlsx (Uint8Array): foaia „Deviz vs executat” + foaia „Despre” (praguri, ziua calculului, ce înseamnă coloanele). */
export function construiesteExportTinte({ tinte, proiect, generatLa }) {
  const meta = metadateTinte(tinte)
  const sortate = ordoneaza(tinte)
  const rows = [CAP_EXPORT, ...randuriExport(sortate)]
  const ws = foaie(rows, [30, 12, 18, 30, 8, 10, 11, 9, 9, 12, 12, 15, 12, 12, 11, 12, 11, 11, 13, 40],
    (r, c) => (c === CAP_EXPORT.length - 1 && (sortate[r - 1]?.alerte || []).length ? ALERTA : CELULA))
  const info = [['Ce', 'Valoare'],
    ['Proiect', proiect ? `${proiect.cod_intern || ''} ${proiect.nume || ''}`.trim() : String(meta.proiect_id)],
    ['Calculat la', data(meta.calculat_la)],
    ['Prag „în urmă”', `${meta.prag_in_urma_pp} puncte procentuale sub planul liniar dintre „Plan start” și „Plan final”`],
    ['Prag „fără raport”', meta.zile_fara_raport == null ? 'oprit' : `${meta.zile_fara_raport} zile fără raport pe un obiect în lucru`],
    ['Din deviz', 'suma articolelor obiectului din catalogul de contract care încep cu codurile activității, fiecare convertit din UM-ul lui în UM-ul activității (HM = 100 m, 100 MC = 100 mc), × factorul suplimentar; „ofertă” = doar contractul inițial, „revizuită” = contract + acte adiționale'],
    ['Executat', 'suma din rapoartele zilnice; la nod, pentru sudurile pe DN: sudurile din schema nodului (sudat / NDT / acceptat / de reparat)'],
    ['Exportat la', generatLa || ''],
  ]
  const wsInfo = foaie(info, [24, 110])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Deviz vs executat')
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Despre')
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
}

export const numeFisierTinte = (cod, azi) => `Deviz_vs_executat_${String(cod || 'proiect').replace(/[^A-Za-z0-9_-]+/g, '_')}_${String(azi).split('-').reverse().join('.')}.xlsx`
