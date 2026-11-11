// ===========================================================================
// Execuție → proiect: „👷 Oameni pe șantier → Excel” (cerere Răzvan 09.11.2026)
// ---------------------------------------------------------------------------
// Cine intră: angajații ACTIVI (employees.active) care
//   (a) au șantierul alocat în ERP (employees.site_id) pe un șantier al proiectului, SAU
//   (b) au ultima zi pontată ca prezență (check_in completat, fără cod de absență în `norma`, ca în Pontaj), cea mai recentă zi
//       ≤ azi, fără limită în trecut, pe un șantier al proiectului (review Jakarinos r1 P1: fără fereastră de zile).
// Șantierele proiectului: STRICT sites.proiect_id = proiectul (review Jakarinos r1 P1).
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

// Șantierele proiectului (o singură definiție, L19): sites.proiect_id = proiectul; chei text
export function santiereProiect(proiectId, sites) {
  const pid = cheie(proiectId)
  return new Set((sites || []).filter(s => s.proiect_id != null && cheie(s.proiect_id) === pid).map(s => cheie(s.id)))
}

// Exportul oprit de utilizator (a ieșit din pagină / a schimbat proiectul): nu e eroare de afișat
export class ExportAnulat extends Error {
  constructor() { super('export anulat'); this.name = 'ExportAnulat' }
}

// Ultima zi de PREZENȚĂ a fiecărui angajat (cheie text employee_id → rândul de pontaj). Cu `m` dat, ACUMULEAZĂ în harta existentă:
// istoricul se prelucrează lot cu lot, fără o listă cu tot istoricul și fără push(...rânduri) (limita de argumente, review r2 P2).
export function ultimaPrezenta(pontaje, m = new Map()) {
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
  // filtrul: antetul + rândurile funcțiilor, FĂRĂ rândul TOTAL (review Jakarinos r1 P2)
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(cap.length - 1)}${sin.linii.length + 1}` }
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

// Citirea din BD: toate pe chei (id crescător, până la pagina goală); orice eroare = excepție cu mesaj (L18, L23).
// Ultima prezență fără limită în trecut, citind doar ce poate schimba rezultatul:
//   1. prezențele pe șantierele proiectului (≤ azi) → candidații și ultima lor zi pe proiect (dP);
//   2. pentru cei cu dP: doar zilele de DUPĂ cel mai mic dP din bucată (o zi pe angajat — cheie unică employee_id + date —, deci o
//      prezență mai nouă oriunde e strict după dP); pentru alocații fără nicio prezență pe proiect: tot istoricul lor (≤ azi).
// semnal.anulat (setat de buton la demontare / schimbarea proiectului) oprește citirea între pagini cu ExportAnulat.
export async function incarcaOameniProiect(sb, proiectId, azi = aziBucuresti(), semnal = null) {
  const pid = Number(proiectId)
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('proiect invalid')
  const eroare = (ce, e) => new Error(`${ce}: ${e?.message || e || 'eroare'}`)
  const verifica = () => { if (semnal?.anulat) throw new ExportAnulat() }
  const toate = (fabrica, ce) => paginareKeyset((ultim, n) => {
    if (semnal?.anulat) return Promise.resolve({ error: new ExportAnulat() })
    let q = fabrica()
    if (ultim != null) q = q.gt('id', ultim)
    return q.order('id', { ascending: true }).limit(n).then(r => (r.error ? { error: eroare(ce, r.error) } : r))
  })
  const prezente = (filtre, ce) => toate(() => filtre(sb.from('pontaj_records').select(COLOANE_PONTAJ)).lte('date', azi).not('check_in', 'is', null), ce)
  verifica()
  const { data: p, error: ep } = await sb.from('executie_proiecte').select('id,cod_intern').eq('id', pid).maybeSingle()
  if (ep) throw eroare('proiectul', ep)
  if (!p) throw new Error('proiectul nu se poate citi (nu există sau nu ai drept pe el)')
  const sites = await toate(() => sb.from('sites').select('id,name,proiect_id'), 'șantierele')
  const santiere = santiereProiect(pid, sites)
  const numeSantier = new Map(sites.map(s => [cheie(s.id), String(s.name || '').trim()]))
  if (!santiere.size) return { proiect: p, santiere, numeSantier, angajati: [], ultime: new Map(), azi }
  const sIds = [...santiere]
  const alocati = await toate(() => sb.from('employees').select(COLOANE_ANGAJAT).eq('active', true).in('site_id', sIds), 'angajații alocați')
  const peProiect = await prezente(q => q.in('site_id', sIds), 'pontajul pe șantierele proiectului')
  const dP = ultimaPrezenta(peProiect)                       // ultima zi de prezență PE PROIECT, pe angajat
  const alocatiIds = new Set(alocati.map(e => cheie(e.id)))
  const cuDp = [...dP.keys()]                                 // candidații (alocați sau nu) cu prezență pe proiect
  const faraDp = [...alocatiIds].filter(k => !dP.has(k))
  const ultime = ultimaPrezenta(peProiect)                    // se completează lot cu lot (fără listă cu tot istoricul)
  for (const b of bucati(cuDp, BUCATA_IN)) {
    const minDp = b.map(k => dP.get(k).date).sort()[0]
    ultimaPrezenta(await prezente(q => q.in('employee_id', b).gt('date', minDp), 'ultimul pontaj'), ultime)
  }
  for (const b of bucati(faraDp, BUCATA_IN)) ultimaPrezenta(await prezente(q => q.in('employee_id', b), 'ultimul pontaj'), ultime)
  const altii = []
  for (const b of bucati([...dP.keys()].filter(k => !alocatiIds.has(k)), BUCATA_IN)) {
    for (const e of await toate(() => sb.from('employees').select(COLOANE_ANGAJAT).eq('active', true).in('id', b), 'angajații pontați')) altii.push(e)
  }
  verifica()
  return { proiect: p, santiere, numeSantier, angajati: alocati.concat(altii), ultime, azi }
}

// Totul: citire → rânduri → foi → fișier. faraSantiere / nrOameni = 0 se raportează distinct (nu e eroare, nici succes tăcut)
export async function exportaOameniProiect(sb, proiectId, azi = aziBucuresti(), semnal = null) {
  const d = await incarcaOameniProiect(sb, proiectId, azi, semnal)
  const baza = { cod: d.proiect.cod_intern }
  if (!d.santiere.size) return { ...baza, faraSantiere: true, nrOameni: 0, nrFoi: 0 }
  const foi = grupeazaPeFoi(alcatuiesteOameni(d), d.numeSantier)
  const nrOameni = foi.reduce((a, f) => a + f.randuri.length, 0)
  if (!nrOameni) return { ...baza, faraSantiere: false, nrOameni: 0, nrFoi: 0 }
  return { ...baza, faraSantiere: false, nrOameni, nrFoi: foi.length, bytes: await construiesteXlsx({ foi, azi }), numeFisier: numeFisier(d.proiect.cod_intern, azi) }
}
