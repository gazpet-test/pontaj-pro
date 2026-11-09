// ===========================================================================
// Execuție → proiect: „👷 Oameni pe șantier → Excel” (cerere Răzvan 09.11.2026)
// ---------------------------------------------------------------------------
// Cine intră: angajații ACTIVI (employees.active) care
//   (a) au șantierul alocat în ERP (employees.site_id) pe un șantier al proiectului, SAU
//   (b) au ultima zi pontată ca prezență (check_in completat, fără cod de absență în `norma`, ca în Pontaj), cu ziua ≤ azi și în
//       ultimele FEREASTRA_ZILE zile, pe un șantier al proiectului.
// Șantierele proiectului: sites.proiect_id = proiectul, plus șantierul principal (executie_proiecte.site_id) dacă nu e legat de alt proiect.
// Foaia omului: șantierul alocat, dacă e al proiectului; altfel șantierul ultimului pontaj. Galben: ultimul pontaj e pe alt șantier
// decât cel alocat.
// Fără date personale: doar coloanele din COLOANE_ANGAJAT, toate din EMPLOYEES_PUBLIC_COLUMNS (verificat în test).
// Citiri: toate pe chei (paginareKeyset, L23); o eroare se aruncă și se afișează (L18), nu devine listă goală.
// Fișierul: „Sinteza” (funcții × șantiere) + o foaie pe șantier; antet înghețat, filtre, landscape. Înghețarea și pagina se scriu
// în XML-ul foii (ca în exportCentralizatorXlsx.js): xlsx-js-style nu le scrie singur.
// ===========================================================================
import * as XLSX_mod from 'xlsx-js-style'
import JSZip from 'jszip'
import { paginareKeyset, aziBucuresti } from './hrDeciziiUtil.js'
const XLSX = XLSX_mod.default || XLSX_mod

export const FEREASTRA_ZILE = 60
// coloane PUBLICE din employees (fără CNP, telefon, adresă, IBAN etc.)
export const COLOANE_ANGAJAT = 'id,name,functie,position,department,departament_hr,site_id,active'
const COLOANE_PONTAJ = 'id,employee_id,date,site_id,check_in,norma'
const BUCATA_IN = 100   // id-uri pe cerere în .in(), ca URL-ul să rămână scurt

// ── date calendaristice 'YYYY-MM-DD', fără fus orar (L17): aritmetică pe data goală, în UTC ──
export function adunaZile(ymd, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''))
  if (!m) throw new Error('dată invalidă: ' + ymd)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10)
}
export const zzll = (ymd) => (ymd ? `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}` : '')
const zzllaaaa = (ymd) => `${ymd.slice(8, 10)}.${ymd.slice(5, 7)}.${ymd.slice(0, 4)}`
const cheie = (v) => (v == null ? null : String(v))
const cmpRo = (a, b) => String(a || '').localeCompare(String(b || ''), 'ro', { sensitivity: 'base', numeric: true })

// Prezență = pontat cu oră de intrare, fără cod de absență și cu șantier (regula din Pontaj: check_in && !norma)
export const estePrezenta = (r) => !!r && r.check_in != null && r.check_in !== '' && !r.norma && r.site_id != null

// Șantierele proiectului (o singură definiție, L19): chei text
export function santiereProiect(proiectId, siteIdPrincipal, sites) {
  const pid = cheie(proiectId)
  const ids = new Set((sites || []).filter(s => s.proiect_id != null && cheie(s.proiect_id) === pid).map(s => cheie(s.id)))
  if (siteIdPrincipal != null) {
    const s = (sites || []).find(x => cheie(x.id) === cheie(siteIdPrincipal))
    if (s && (s.proiect_id == null || cheie(s.proiect_id) === pid)) ids.add(cheie(s.id))
  }
  return ids
}

// Ultima zi de PREZENȚĂ a fiecărui angajat (cheie text employee_id → rândul de pontaj)
export function ultimaPrezenta(pontaje) {
  const m = new Map()
  const maiMare = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a > b : String(a) > String(b))
  for (const r of pontaje || []) {
    if (!estePrezenta(r)) continue
    const k = cheie(r.employee_id), v = m.get(k)
    if (!v || r.date > v.date || (r.date === v.date && maiMare(r.id, v.id))) m.set(k, r)
  }
  return m
}

// Rândurile exportului: cine intră, pe ce foaie, cu ce marcaj
export function alcatuiesteOameni({ santiere, numeSantier, angajati, ultime }) {
  const numeS = (k) => (k == null ? '' : (numeSantier.get(k) || `șantier #${k}`))
  const unici = new Map()
  for (const e of angajati || []) if (e && e.id != null && !unici.has(cheie(e.id))) unici.set(cheie(e.id), e)
  const out = []
  for (const e of unici.values()) {
    if (e.active !== true) continue
    const alocat = cheie(e.site_id)
    const u = ultime.get(cheie(e.id)) || null
    const ultSite = u ? cheie(u.site_id) : null
    const peAlocat = alocat != null && santiere.has(alocat)
    const pePontaj = ultSite != null && santiere.has(ultSite)
    if (!peAlocat && !pePontaj) continue
    out.push({
      id: e.id,
      nume: String(e.name || '').trim(),
      functie: String(e.functie || e.position || '').trim(),
      departament: String(e.department || e.departament_hr || '').trim(),
      santierAlocat: numeS(alocat),
      pontatPe: numeS(ultSite),
      data: u ? u.date : null,
      alt: ultSite != null && ultSite !== alocat,
      foaie: peAlocat ? alocat : ultSite,
    })
  }
  return out
}

// O foaie pe șantier, în ordinea numelui; rândurile după funcție, apoi nume
export function grupeazaPeFoi(randuri, numeSantier) {
  const pe = new Map()
  for (const r of randuri) { if (!pe.has(r.foaie)) pe.set(r.foaie, []); pe.get(r.foaie).push(r) }
  return [...pe.entries()]
    .map(([k, rs]) => ({ siteId: k, santier: numeSantier.get(k) || `șantier #${k}`, randuri: rs.sort((a, b) => cmpRo(a.functie, b.functie) || cmpRo(a.nume, b.nume)) }))
    .sort((a, b) => cmpRo(a.santier, b.santier))
}

export const cheieFunctie = (f) => String(f || '').replace(/\s+/g, ' ').trim().toLocaleUpperCase('ro') || '(FĂRĂ FUNCȚIE)'
// Sinteza: număr pe funcție × foaie, descrescător după total; plus totalurile
export function sinteza(foi) {
  const m = new Map()
  foi.forEach((f, i) => f.randuri.forEach(r => {
    const k = cheieFunctie(r.functie)
    if (!m.has(k)) m.set(k, foi.map(() => 0))
    m.get(k)[i]++
  }))
  const linii = [...m.entries()].map(([functie, nr]) => ({ functie, nr, total: nr.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total || cmpRo(a.functie, b.functie))
  const total = foi.map(f => f.randuri.length)
  return { linii, total, totalGeneral: total.reduce((a, b) => a + b, 0) }
}

// Numele foilor: fără caracterele interzise de Excel, max. 31, unice (fără să țină cont de litere mari), diferite de „Sinteza”
export function numeFoi(foi) {
  const folosite = new Set(['sinteza'])
  return foi.map(f => {
    let baza = String(f.santier || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim().slice(0, 31).trim()
    if (!baza) baza = 'Santier'
    let nume = baza
    for (let i = 2; folosite.has(nume.toLowerCase()); i++) { const suf = ` (${i})`; nume = baza.slice(0, 31 - suf.length).trim() + suf }
    folosite.add(nume.toLowerCase())
    return nume
  })
}

// ── stiluri (ca modelul: antet albastru cu alb, borduri subțiri, de completat în albastru deschis, galben la șantier diferit) ──
const LINIE = { style: 'thin', color: { rgb: '000000' } }
const BORDURA = { top: LINIE, bottom: LINIE, left: LINIE, right: LINIE }
const FONT = { name: 'Calibri', sz: 11 }
export const CULORI = { antet: '1F5FA8', deCompletat: 'E8F1FB', altSantier: 'FFF2CC' }
const STIL_ANTET = { font: { ...FONT, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: CULORI.antet } },
  alignment: { vertical: 'center', wrapText: true }, border: BORDURA }
const STIL_TOTAL = { font: { ...FONT, bold: true }, border: BORDURA }
const plin = (rgb) => ({ patternType: 'solid', fgColor: { rgb } })
export const coloaneFoaie = (maine) => ['Nr', 'Nume', 'Funcție', 'Departament', 'Șantier alocat în ERP', 'Pontat ultima dată pe', 'Data',
  `Mâine ${zzll(maine)} – front / echipă`, 'Șef echipă', 'Observații']
const LATIMI_FOAIE = [5, 30, 26, 18, 30, 30, 8, 30, 20, 30]
// stilul unei celule de date pe foaia de șantier (index de coloană 0..9)
export function stilCelula(col, rand) {
  const s = { font: FONT, border: BORDURA, alignment: { vertical: 'center' } }
  if (col === 7 || col === 8) s.fill = plin(CULORI.deCompletat)
  if (col === 5 && rand.alt) s.fill = plin(CULORI.altSantier)
  return s
}
const MARGINI = { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
const adresa = (r, c) => XLSX.utils.encode_cell({ r, c })

function foaieSantier(f, maine) {
  const cap = coloaneFoaie(maine)
  const date = f.randuri.map((r, i) => [i + 1, r.nume, r.functie, r.departament, r.santierAlocat, r.pontatPe, zzll(r.data), '', '', ''])
  const ws = XLSX.utils.aoa_to_sheet([cap, ...date])
  cap.forEach((_, c) => { ws[adresa(0, c)].s = STIL_ANTET })
  f.randuri.forEach((r, i) => cap.forEach((_, c) => {
    const a = adresa(i + 1, c)
    if (!ws[a]) ws[a] = { t: 's', v: '' }
    ws[a].s = stilCelula(c, r)
  }))
  ws['!cols'] = LATIMI_FOAIE.map(w => ({ wch: w }))
  ws['!rows'] = [{ hpt: 32 }]
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(cap.length - 1)}${f.randuri.length + 1}` }
  ws['!margins'] = MARGINI
  return ws
}

function foaieSinteza(foi, sin) {
  const cap = ['Funcție', ...foi.map(f => f.santier), 'Total']
  const rows = [cap, ...sin.linii.map(l => [l.functie, ...l.nr, l.total]), ['TOTAL', ...sin.total, sin.totalGeneral]]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  rows.forEach((row, r) => row.forEach((_, c) => {
    const a = adresa(r, c)
    ws[a].s = r === 0 ? STIL_ANTET : r === rows.length - 1 ? STIL_TOTAL : { font: FONT, border: BORDURA }
  }))
  ws['!cols'] = [{ wch: 38 }, ...foi.map(() => ({ wch: 16 })), { wch: 10 }]
  ws['!rows'] = [{ hpt: 32 }]
  ws['!margins'] = MARGINI
  return ws
}

// Înghețare + pagină în XML-ul foii. Ordinea elementelor din <worksheet> e fixă (sheetPr, dimension, sheetViews, …, pageMargins,
// pageSetup): sheetPr primul, sheetViews după dimension, pageSetup imediat după pageMargins. Lipsa unui reper = eroare, nu fișier stricat.
export function completeazaFoaieXml(xml, { xSplit, ySplit }) {
  const sus = `${String.fromCharCode(65 + xSplit)}${ySplit + 1}`
  const panou = xSplit > 0 ? 'bottomRight' : 'bottomLeft'
  const vederi = `<sheetViews><sheetView workbookViewId="0"><pane${xSplit > 0 ? ` xSplit="${xSplit}"` : ''} ySplit="${ySplit}" topLeftCell="${sus}" activePane="${panou}" state="frozen"/><selection pane="${panou}" activeCell="${sus}" sqref="${sus}"/></sheetView></sheetViews>`
  const pagina = '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
  let x = String(xml)
  if (!/<dimension[^>]*\/>/.test(x) || !/<pageMargins[^>]*\/>/.test(x)) throw new Error('foaia xlsx nu are structura așteptată (dimension / pageMargins)')
  x = /<sheetViews[\s>]/.test(x) ? x.replace(/<sheetViews[\s\S]*?<\/sheetViews>/, vederi) : x.replace(/(<dimension[^>]*\/>)/, `$1${vederi}`)
  if (/<sheetPr[^>]*\/>/.test(x)) x = x.replace(/<sheetPr([^>]*)\/>/, '<sheetPr$1><pageSetUpPr fitToPage="1"/></sheetPr>')
  else if (/<sheetPr[\s>]/.test(x)) x = x.replace('</sheetPr>', '<pageSetUpPr fitToPage="1"/></sheetPr>')
  else x = x.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>')
  x = /<pageSetup[\s/]/.test(x) ? x.replace(/<pageSetup[^>]*\/>/, pagina) : x.replace(/(<pageMargins[^>]*\/>)/, `$1${pagina}`)
  return x
}

// Fișierul .xlsx (octeți)
export async function construiesteXlsx({ foi, azi }) {
  const maine = adunaZile(azi, 1)
  const sin = sinteza(foi)
  const nume = numeFoi(foi)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, foaieSinteza(foi, sin), 'Sinteza')
  foi.forEach((f, i) => XLSX.utils.book_append_sheet(wb, foaieSantier(f, maine), nume[i]))
  const brut = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true })
  const zip = await JSZip.loadAsync(brut)
  for (let i = 1; i <= foi.length + 1; i++) {
    const cale = `xl/worksheets/sheet${i}.xml`
    const f = zip.file(cale)
    if (!f) throw new Error('foaia xlsx lipsește: ' + cale)
    zip.file(cale, completeazaFoaieXml(await f.async('string'), i === 1 ? { xSplit: 0, ySplit: 1 } : { xSplit: 2, ySplit: 1 }))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

export const numeFisier = (cod, azi) => `Oameni_santier_${String(cod || 'proiect').replace(/[^A-Za-z0-9_-]+/g, '_')}_${zzllaaaa(azi)}.xlsx`

function bucati(lista, n) {
  const out = []
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n))
  return out
}

// Citirea din BD: toate pe chei (id crescător, până la pagina goală); orice eroare = excepție cu mesaj (L18, L23)
export async function incarcaOameniProiect(sb, proiectId, azi = aziBucuresti()) {
  const pid = Number(proiectId)
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('proiect invalid')
  const de = adunaZile(azi, -FEREASTRA_ZILE)
  const eroare = (ce, e) => new Error(`${ce}: ${e?.message || e || 'eroare'}`)
  const toate = (fabrica, ce) => paginareKeyset((ultim, n) => {
    let q = fabrica()
    if (ultim != null) q = q.gt('id', ultim)
    return q.order('id', { ascending: true }).limit(n).then(r => (r.error ? { error: eroare(ce, r.error) } : r))
  })
  const { data: p, error: ep } = await sb.from('executie_proiecte').select('id,cod_intern,site_id').eq('id', pid).maybeSingle()
  if (ep) throw eroare('proiectul', ep)
  if (!p) throw new Error('proiectul nu se poate citi (nu există sau nu ai drept pe el)')
  const sites = await toate(() => sb.from('sites').select('id,name,proiect_id'), 'șantierele')
  const santiere = santiereProiect(pid, p.site_id, sites)
  const numeSantier = new Map(sites.map(s => [cheie(s.id), String(s.name || '').trim()]))
  if (!santiere.size) return { proiect: p, santiere, numeSantier, angajati: [], ultime: new Map(), de, azi }
  const sIds = [...santiere]
  const alocati = await toate(() => sb.from('employees').select(COLOANE_ANGAJAT).eq('active', true).in('site_id', sIds), 'angajații alocați')
  const peSantier = await toate(() => sb.from('pontaj_records').select(COLOANE_PONTAJ).in('site_id', sIds)
    .gte('date', de).lte('date', azi).not('check_in', 'is', null), 'pontajul pe șantierele proiectului')
  const candidati = new Set(peSantier.filter(estePrezenta).map(r => cheie(r.employee_id)))
  const deCitit = [...new Set([...alocati.map(e => cheie(e.id)), ...candidati])]
  const pontaje = []
  for (const b of bucati(deCitit, BUCATA_IN)) {
    pontaje.push(...await toate(() => sb.from('pontaj_records').select(COLOANE_PONTAJ).in('employee_id', b)
      .gte('date', de).lte('date', azi).not('check_in', 'is', null), 'ultimul pontaj'))
  }
  const alocatiIds = new Set(alocati.map(e => cheie(e.id)))
  const altii = []
  for (const b of bucati([...candidati].filter(k => !alocatiIds.has(k)), BUCATA_IN)) {
    altii.push(...await toate(() => sb.from('employees').select(COLOANE_ANGAJAT).eq('active', true).in('id', b), 'angajații pontați'))
  }
  return { proiect: p, santiere, numeSantier, angajati: [...alocati, ...altii], ultime: ultimaPrezenta(pontaje), de, azi }
}

// Totul: citire → rânduri → foi → fișier. faraSantiere / nrOameni = 0 se raportează distinct (nu e eroare, nici succes tăcut)
export async function exportaOameniProiect(sb, proiectId, azi = aziBucuresti()) {
  const d = await incarcaOameniProiect(sb, proiectId, azi)
  const baza = { fereastra: FEREASTRA_ZILE, cod: d.proiect.cod_intern }
  if (!d.santiere.size) return { ...baza, faraSantiere: true, nrOameni: 0, nrFoi: 0 }
  const foi = grupeazaPeFoi(alcatuiesteOameni(d), d.numeSantier)
  const nrOameni = foi.reduce((a, f) => a + f.randuri.length, 0)
  if (!nrOameni) return { ...baza, faraSantiere: false, nrOameni: 0, nrFoi: 0 }
  return { ...baza, faraSantiere: false, nrOameni, nrFoi: foi.length, bytes: await construiesteXlsx({ foi, azi }), numeFisier: numeFisier(d.proiect.cod_intern, azi) }
}
