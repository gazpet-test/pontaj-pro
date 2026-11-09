// Execuție → proiect → 🌧️ Meteo: istoricul zilnic pe șantier (v_meteo_zile, migrarea 20261202a) — calendar, rezumate, export Excel.
// „Zi nelucrabilă” NU se recalculează aici: vine calculată din vedere (o singură definiție, L19); aici doar se afișează / se exportă.
// Citirea: pe chei (data crescător, pe fiecare șantier, până la pagina goală, L23); orice eroare se aruncă cu mesaj (L18).
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { completeazaFoaieXml } from './executieOameniXlsx.js'
const XLSX = XLSX_mod.default || XLSX_mod

export const COLOANE = 'site_id,data,precipitatii_mm,ploaie_mm,zapada_cm,tmin_c,tmax_c,vant_max_kmh,rafale_max_kmh,cod_vreme,lat,lng,sursa,preluat_la,zi_nelucrabila,motive,precipitatii_mm_min,zapada_cm_min,tmax_sub_c,tmin_max_c,praguri_versiune'
export const ZILE_SAPT = ['Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ', 'Du']
const NUME_ZI = ['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă']
export const LUNI = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie']

// codul vremii (WMO 4677, cum îl dă Open-Meteo) → descriere + iconiță
export function vremeWmo(cod) {
  if (cod == null) return { text: '—', icon: '·' }
  const c = Number(cod)
  if (c === 0) return { text: 'Senin', icon: '☀️' }
  if (c <= 2) return { text: 'Parțial noros', icon: '🌤️' }
  if (c === 3) return { text: 'Înnorat', icon: '☁️' }
  if (c === 45 || c === 48) return { text: 'Ceață', icon: '🌫️' }
  if (c >= 51 && c <= 57) return { text: 'Burniță', icon: '🌦️' }
  if (c >= 61 && c <= 67) return { text: c >= 66 ? 'Ploaie înghețată' : 'Ploaie', icon: '🌧️' }
  if (c >= 71 && c <= 77) return { text: 'Ninsoare', icon: '🌨️' }
  if (c >= 80 && c <= 82) return { text: 'Averse de ploaie', icon: '🌧️' }
  if (c === 85 || c === 86) return { text: 'Averse de ninsoare', icon: '🌨️' }
  if (c >= 95) return { text: 'Furtună', icon: '⛈️' }
  return { text: `cod ${c}`, icon: '🌡️' }
}

const zi = (an, luna, d) => `${an}-${String(luna).padStart(2, '0')}-${String(d).padStart(2, '0')}`
export const zileInLuna = (an, luna) => new Date(Date.UTC(an, luna, 0)).getUTCDate()   // luna 1–12
// săptămânile lunii, începând cu luni; celulele din afara lunii = null
export function calendarLuna(an, luna) {
  const prima = (new Date(Date.UTC(an, luna - 1, 1)).getUTCDay() + 6) % 7   // 0 = luni
  const n = zileInLuna(an, luna)
  const celule = [...Array(prima).fill(null), ...Array.from({ length: n }, (_, i) => zi(an, luna, i + 1))]
  while (celule.length % 7) celule.push(null)
  const sapt = []
  for (let i = 0; i < celule.length; i += 7) sapt.push(celule.slice(i, i + 7))
  return sapt
}
export const ziSaptamana = (ymd) => NUME_ZI[new Date(`${ymd}T12:00:00Z`).getUTCDay()]
export const eticheta = (v) => (v === true ? 'DA' : v === false ? 'NU' : 'necunoscut')
export const cheieLuna = (ymd) => ymd.slice(0, 7)
export const numeLuna = (k) => `${LUNI[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`

// rezumatul unei luni pe un șantier: zile cu date, nelucrabile, necunoscute (date incomplete), fără date (zile fără înregistrare)
export function rezumatLuna(randuri, an, luna, azi) {
  const n = zileInLuna(an, luna)
  const k = zi(an, luna, 1).slice(0, 7)
  const ale = randuri.filter(r => r.data.startsWith(k))
  const trecute = Array.from({ length: n }, (_, i) => zi(an, luna, i + 1)).filter(d => !azi || d < azi).length
  return {
    cuDate: ale.length,
    nelucrabile: ale.filter(r => r.zi_nelucrabila === true).length,
    necunoscute: ale.filter(r => r.zi_nelucrabila == null).length,
    faraDate: Math.max(0, trecute - ale.length),
  }
}
// pe luni, pentru tot istoricul unui șantier (crescător)
export function peLuni(randuri) {
  const m = new Map()
  for (const r of randuri) {
    const k = cheieLuna(r.data)
    if (!m.has(k)) m.set(k, { luna: k, cuDate: 0, nelucrabile: 0, necunoscute: 0 })
    const o = m.get(k)
    o.cuDate++
    if (r.zi_nelucrabila === true) o.nelucrabile++
    else if (r.zi_nelucrabila == null) o.necunoscute++
  }
  return [...m.values()].sort((a, b) => (a.luna < b.luna ? -1 : 1))
}
const fmt = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: d }))
export function motiveText(r) {
  const out = []
  for (const m of r.motive || []) {
    if (m === 'precipitatii') out.push(`precipitații ${fmt(r.precipitatii_mm)} mm ≥ ${fmt(r.precipitatii_mm_min)}`)
    else if (m === 'zapada') out.push(`zăpadă ${fmt(r.zapada_cm)} cm ≥ ${fmt(r.zapada_cm_min)}`)
    else if (m === 'tmax') out.push(`Tmax ${fmt(r.tmax_c)} °C < ${fmt(r.tmax_sub_c)}`)
    else if (m === 'tmin') out.push(`Tmin ${fmt(r.tmin_c)} °C ≤ ${fmt(r.tmin_max_c)}`)
  }
  return out.join('; ')
}
export const pragText = (p) => (p ? `precipitații ≥ ${fmt(p.precipitatii_mm_min)} mm sau zăpadă ≥ ${fmt(p.zapada_cm_min)} cm sau Tmax < ${fmt(p.tmax_sub_c)} °C sau Tmin ≤ ${fmt(p.tmin_max_c)} °C` : '—')

// toate zilele șantierelor, pe chei (data, pe fiecare șantier) până la pagina goală; opțional [de, pana]
export async function toateZilele(client, siteIds, { de = null, pana = null, pas = 1000, semnal = null } = {}) {
  const out = []
  for (const s of siteIds) {
    for (let ultima = null; ;) {
      if (semnal?.anulat) throw Object.assign(new Error('anulat'), { anulat: true })
      let q = client.from('v_meteo_zile').select(COLOANE).eq('site_id', s)
      if (de) q = q.gte('data', de)
      if (pana) q = q.lte('data', pana)
      if (ultima) q = q.gt('data', ultima)
      const { data, error } = await q.order('data', { ascending: true }).limit(pas)
      if (error) throw new Error('istoricul meteo nu se poate citi: ' + (error.message || 'eroare'))
      if (!data || !data.length) break
      const u = data[data.length - 1].data
      if (ultima != null && !(u > ultima)) throw new Error('istoricul meteo: paginare neordonată')
      for (const r of data) out.push(r)
      ultima = u
    }
  }
  return out
}

// ── exportul Excel: „Zile” (toate zilele), „Pe luni”, „Praguri și sursă” ──
const LINIE = { style: 'thin', color: { rgb: '000000' } }
const BORDURA = { top: LINIE, bottom: LINIE, left: LINIE, right: LINIE }
const ANTET = { font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1F5FA8' } },
  alignment: { vertical: 'center', wrapText: true }, border: BORDURA }
const CELULA = { font: { name: 'Calibri', sz: 11 }, border: BORDURA }
export const CULOARE_NELUCRABIL = 'F8CBAD'
const MARGINI = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
const nr = (v) => (v == null ? '' : Number(v))

function foaie(rows, latimi, { filtru = true, stil = null } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  rows.forEach((row, r) => row.forEach((_, c) => {
    const a = XLSX.utils.encode_cell({ r, c })
    if (!ws[a]) ws[a] = { t: 's', v: '' }
    ws[a].s = r === 0 ? ANTET : (stil ? stil(r, c) : CELULA)
  }))
  ws['!cols'] = latimi.map(w => ({ wch: w }))
  ws['!rows'] = [{ hpt: 32 }]
  if (filtru && rows.length > 1) ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}` }
  ws['!margins'] = MARGINI
  return ws
}

export const CAP_ZILE = ['Șantier', 'Data', 'Ziua', 'Precipitații (mm)', 'Ploaie (mm)', 'Zăpadă (cm)', 'Tmin (°C)', 'Tmax (°C)', 'Vânt max (km/h)',
  'Rafale max (km/h)', 'Vremea', 'Zi nelucrabilă', 'Motive', 'Coordonate', 'Sursa', 'Preluat la']

export async function construiesteExport({ santiere, randuri, praguri, generatLa }) {
  const nume = new Map(santiere.map(s => [String(s.id), s.name || `șantier #${s.id}`]))
  const sortate = [...randuri].sort((a, b) => (String(a.site_id) === String(b.site_id) ? (a.data < b.data ? -1 : 1) : (nume.get(String(a.site_id)) || '').localeCompare(nume.get(String(b.site_id)) || '', 'ro')))
  const zile = [CAP_ZILE, ...sortate.map(r => [nume.get(String(r.site_id)) || `șantier #${r.site_id}`, r.data.split('-').reverse().join('.'), ziSaptamana(r.data),
    nr(r.precipitatii_mm), nr(r.ploaie_mm), nr(r.zapada_cm), nr(r.tmin_c), nr(r.tmax_c), nr(r.vant_max_kmh), nr(r.rafale_max_kmh),
    r.cod_vreme == null ? '' : `${vremeWmo(r.cod_vreme).text} (${r.cod_vreme})`, eticheta(r.zi_nelucrabila), motiveText(r),
    `${r.lat}, ${r.lng}`, 'Open-Meteo — arhivă', r.preluat_la ? String(r.preluat_la).slice(0, 16).replace('T', ' ') : ''])]
  const wsZile = foaie(zile, [26, 11, 10, 10, 9, 9, 8, 8, 9, 9, 20, 10, 40, 20, 18, 16], {
    stil: (r, c) => (sortate[r - 1]?.zi_nelucrabila === true && (c === 1 || c === 11) ? { ...CELULA, fill: { patternType: 'solid', fgColor: { rgb: CULOARE_NELUCRABIL } } } : CELULA),
  })
  const luni = [['Șantier', 'Luna', 'Zile cu date', 'Zile nelucrabile', 'Necunoscute (date incomplete)']]
  for (const s of santiere) for (const l of peLuni(sortate.filter(r => String(r.site_id) === String(s.id)))) luni.push([nume.get(String(s.id)), numeLuna(l.luna), l.cuDate, l.nelucrabile, l.necunoscute])
  const wsLuni = foaie(luni, [26, 18, 12, 14, 18])
  const info = [['Ce', 'Valoare'],
    ['Zi nelucrabilă dacă', pragText(praguri)],
    ['Versiunea pragurilor', praguri ? String(praguri.versiune) : '—'],
    ['Pragurile schimbate la', praguri?.actualizat_la ? String(praguri.actualizat_la).slice(0, 16).replace('T', ' ') : '—'],
    ['Sursa datelor', 'Open-Meteo, arhiva istorică (date de reanaliză), valori zilnice pe ziua locală Europe/Bucharest, la coordonatele șantierului din ERP'],
    ['„necunoscut”', 'niciun prag atins, dar lipsește cel puțin o valoare a zilei (nu se consideră lucrabilă)'],
    ['Exportat la', generatLa]]
  const wsInfo = foaie(info, [26, 90], { filtru: false })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, wsZile, 'Zile')
  XLSX.utils.book_append_sheet(wb, wsLuni, 'Pe luni')
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Praguri si sursa')
  const zip = await JSZip.loadAsync(XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }))
  for (const [i, xs] of [[1, 2], [2, 2], [3, 0]]) {
    const cale = `xl/worksheets/sheet${i}.xml`
    zip.file(cale, completeazaFoaieXml(await zip.file(cale).async('string'), { xSplit: xs, ySplit: 1 }))
  }
  return zip.generateAsync({ type: 'uint8array' })
}
export const numeFisierMeteo = (cod, azi) => `Meteo_zile_nelucrabile_${String(cod || 'proiect').replace(/[^A-Za-z0-9_-]+/g, '_')}_${azi.split('-').reverse().join('.')}.xlsx`
