// Rapoarte Șantier → exportul Excel: coloanele de vreme pe fiecare raport / zi și foaia „Vremea — sursă și metodă” (20261221a), plus
// citirea PAGINATĂ a rapoartelor (L23: max-rows 1000 pe server; keyset pe id până la pagina goală, eroarea se aruncă).
// Logica e aici (fără jsPDF / html2canvas / clientul Supabase), ca s-o poată testa vitest; rapoarteExport.js o folosește (și helperii de format).
import { SURSA, RAZA_STATIE_KM, cheie, descriereRo, sursaScurta, textStatie, fmtMoment, vremeExport } from './meteoXweatherUtil.js'

// helperii de format ai exportului (aceiași pentru Excel și PDF)
export const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
export const utj = (r) => Array.isArray(r.utilaje_snapshot) ? r.utilaje_snapshot : []
export const nefunc = (r) => utj(r).filter(u => u.stare === 'nefunctional')
export const alimentate = (r) => utj(r).filter(u => u.alimentat).length

export const CAP_VREME = ['T min (°C)', 'T max (°C)', 'Precipitații (mm)', 'Zăpadă (cm)', 'Vânt max (km/h)', 'Descriere vreme', 'Sursa vremii']
export const FARA_DATE = 'fără date'
export const FOAIE_VREME = 'Vremea — sursă și metodă'
const nr = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : Number(v))

// celulele de vreme ale unui raport: rândul zilei (sau nimic) → numere (goale dacă lipsesc, niciodată 0 inventat) + descriere + sursa
export function celuleVreme(r) {
  if (!r) return ['', '', '', '', '', FARA_DATE, FARA_DATE]
  return [nr(r.tmin_c), nr(r.tmax_c), nr(r.precipitatii_mm), nr(r.zapada_cm), nr(r.vant_max_kmh), descriereRo(r.descriere) || '', sursaScurta(r)]
}

// foaia de sursă și metodă: explicația + pe fiecare șantier exportat coordonatele, stațiile folosite, zilele cu / fără date
export function foaieSursaVreme({ list, vreme, siteNameOf, from, to, generatLa }) {
  const harta = new Map(vreme.map(v => [cheie(v.site_id, v.data), v]))
  const rows = [
    ['Ce', 'Valoare'],
    ['Sursa datelor', `${SURSA} — serviciu de date meteo (NU un senzor montat pe șantier).`],
    ['Ce valori', 'Rezumatul zilnic al condițiilor (endpoint conditions/summary) la coordonatele șantierului din platformă: temperatura minimă / maximă, precipitațiile (mm), zăpada (cm), vântul maxim (km/h) și descrierea vremii. Ziua = ora României (00:00–24:00).'],
    ['Stația de observație', `Stația de observație cea mai apropiată, cu datele zilei (endpoint observations/summary, rază ${RAZA_STATIE_KM} km): identificatorul, numele și distanța, așa cum le dă Xweather. Dacă nu există, se scrie motivul.`],
    ['Cum se preiau', 'Automat, o dată pe zi, pentru ziua încheiată; zilele lipsă se completează automat. Răspunsul complet al furnizorului se păstrează împreună cu valorile.'],
    ['Pot fi modificate?', 'Nu. Datele preluate nu pot fi modificate sau șterse în platformă. Dacă furnizorul corectează o zi, corecția se păstrează ca versiune nouă (aici apare ultima versiune, cu numărul ei în coloana „Sursa vremii”).'],
    ['„fără date”', 'Nu există încă rezumat pentru acea zi (de exemplu ziua în curs, care se preia după miezul nopții). Celulele numerice rămân goale: lipsa nu înseamnă 0.'],
    ['Interval exportat', `${from} → ${to}`],
    ['Exportat la', generatLa],
    ['', ''],
    ['Șantier', 'Coordonate folosite · stații de observație · zile cu rapoarte (cu date / fără date)'],
  ]
  const peSantier = new Map()
  for (const r of list) {
    if (!peSantier.has(r.site_id)) peSantier.set(r.site_id, { zile: new Set() })
    peSantier.get(r.site_id).zile.add(r.data)
  }
  for (const [site, { zile }] of [...peSantier.entries()].sort((a, b) => String(siteNameOf(a[0])).localeCompare(String(siteNameOf(b[0])), 'ro'))) {
    const randuri = [...zile].map(d => harta.get(cheie(site, d))).filter(Boolean)
    const coord = [...new Set(randuri.map(v => `${Number(v.lat)}, ${Number(v.lng)}`))]
    const statii = [...new Set(randuri.map(v => textStatie(v)))]
    rows.push([String(siteNameOf(site)),
      `coordonate: ${coord.length ? coord.join(' / ') : '—'} · ${statii.length ? statii.join(' / ') : 'stație: —'} · ${zile.size} zile cu rapoarte: ${randuri.length} cu date, ${zile.size - randuri.length} ${FARA_DATE}`])
  }
  const ultima = vreme.reduce((m, v) => (v.preluat_la && (!m || v.preluat_la > m) ? v.preluat_la : m), null)
  if (ultima) rows.push(['Ultima preluare în export', fmtMoment(ultima)])
  return rows
}

// toate rapoartele din interval (pe șantierele date, opțional unul), keyset pe id până la pagina goală
export async function toateRapoartele(client, { siteIds, from, to, siteId = null, pas = 1000 }) {
  const ids = siteId != null ? [siteId] : siteIds
  if (!ids.length) return []
  const out = []
  for (let ultim = null; ;) {
    let q = client.from('rapoarte_zilnice').select('*').in('site_id', ids).gte('data', from).lte('data', to)
    if (ultim != null) q = q.gt('id', ultim)
    const { data, error } = await q.order('id', { ascending: true }).limit(pas)
    if (error) throw new Error('rapoartele nu se pot citi: ' + (error.message || 'eroare'))
    if (!data || !data.length) break
    const u = data[data.length - 1].id
    if (u == null || (ultim != null && !(u > ultim))) throw new Error('rapoartele: paginare neordonată')
    for (const r of data) out.push(r)
    ultim = u
  }
  // ordinea ecranului: ziua descrescător, apoi șantierul
  return out.sort((a, b) => (a.data === b.data ? a.site_id - b.site_id : a.data < b.data ? 1 : -1))
}

// Foaia „Rapoarte” (un rând pe raport) + coloanele de vreme pe fiecare raport / zi + foaia „Vremea — sursă și metodă”.
// vreme = rândurile din v_meteo_zilnic_xweather pentru șantierele și intervalul exportat (citite paginat), sau null = funcția nu e încă activă
// (vederea nu există: migrarea 20261221a neaplicată) → registrul EXACT de dinainte: fără coloanele de vreme, fără foaia nouă, antetul vechi.
export const CAP_RAPOARTE = ['Data', 'Șantier', 'Șef șantier', 'Sudori', 'Lăcătuși', 'Operatori', 'Șoferi', 'Necalif.', 'TESA', 'Alții', 'Total pers.', 'Utilaje/mașini', 'Alimentate', 'Nefuncț.', 'Lucrări efectuate', 'Subcontractori', 'Mașini', 'Probleme', 'Plan mâine']
export function construiesteRapoarteXlsx({ XLSX, list, siteNameOf, titluSite, from, to, vreme, generatLa }) {
  const cuVreme = vreme != null
  const thin = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  const headerStyle = { fill: { fgColor: { rgb: '1F3A5F' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: thin }
  const cellBase = { font: { name: 'Calibri', sz: 10 }, alignment: { vertical: 'top', wrapText: true }, border: thin }
  const CAP = cuVreme ? [...CAP_RAPOARTE, ...CAP_VREME] : [...CAP_RAPOARTE]
  const COLS = CAP.length
  const V0 = CAP_RAPOARTE.length   // prima coloană de vreme (doar cu vreme)
  const harta = new Map((vreme || []).map(v => [cheie(v.site_id, v.data), v]))

  const sorted = [...list].sort((a, b) => a.data.localeCompare(b.data))
  const antet = `${titluSite}  •  ${from} → ${to}  •  Generat: ${generatLa}  •  ${sorted.length} rapoarte`
  const aoa = [
    ['RAPOARTE ȘANTIER'],
    [cuVreme ? `${antet}  •  vremea: ${harta.size ? 'Vaisala Xweather (vezi foaia „' + FOAIE_VREME + '”)' : 'fără date Vaisala Xweather în interval'}` : antet],
    [],
    CAP,
  ]
  sorted.forEach(r => {
    const p = r.personal_snapshot || {}
    aoa.push([
      fmtData(r.data), siteNameOf(r.site_id), r.sef_santier || '—',
      p.sudori || 0, p.lacatusi || 0, p.operatori || 0, p.soferi || 0, p.necalificati || 0, p.tesa || 0, p.altii || 0, p.total || 0,
      utj(r).length, alimentate(r), nefunc(r).length,
      r.lucrari_efectuate || '', r.subcontractori || '', r.masini || '', r.probleme || '', r.plan_maine || '',
      ...(cuVreme ? celuleVreme(harta.get(cheie(r.site_id, r.data))) : []),
    ])
  })

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: COLS - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: COLS - 1 } }]
  ws['A1'] = { v: aoa[0][0], t: 's', s: { font: { sz: 14, bold: true, color: { rgb: '1F3A5F' } }, alignment: { horizontal: 'center' } } }
  ws['A2'] = { v: aoa[1][0], t: 's', s: { font: { sz: 9, italic: true, color: { rgb: '666666' } }, alignment: { horizontal: 'center' } } }
  for (let c = 0; c < COLS; c++) { const ref = XLSX.utils.encode_cell({ r: 3, c }); if (ws[ref]) ws[ref].s = headerStyle }
  for (let r = 4; r < aoa.length; r++) {
    for (let c = 0; c < COLS; c++) {
      const ref = XLSX.utils.encode_cell({ r, c })
      if (!ws[ref]) continue
      ws[ref].s = { ...cellBase }
      if ((c >= 3 && c <= 13) || (cuVreme && c >= V0 && c < V0 + 5)) ws[ref].s.alignment = { ...cellBase.alignment, horizontal: 'center', vertical: 'center' }
    }
  }
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 9 }, { wch: 13 }, { wch: 10 }, { wch: 8 }, { wch: 42 }, { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 30 },
    ...(cuVreme ? [{ wch: 8 }, { wch: 8 }, { wch: 11 }, { wch: 9 }, { wch: 10 }, { wch: 22 }, { wch: 60 }] : [])]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Rapoarte')
  if (!cuVreme) return wb

  const sursa = foaieSursaVreme({ list: sorted, vreme, siteNameOf, from, to, generatLa })
  const wsV = XLSX.utils.aoa_to_sheet(sursa)
  sursa.forEach((row, r) => row.forEach((_, c) => {
    const ref = XLSX.utils.encode_cell({ r, c })
    if (!wsV[ref]) return
    wsV[ref].s = (r === 0 || row[0] === 'Șantier') ? headerStyle : { ...cellBase, font: { ...cellBase.font, bold: c === 0 } }
  }))
  wsV['!cols'] = [{ wch: 30 }, { wch: 120 }]
  XLSX.utils.book_append_sheet(wb, wsV, FOAIE_VREME)
  return wb
}

// citirea vremii + registrul (folosit de exportRapoarteExcel): vederea inexistentă încă = registrul de dinainte; altă eroare se aruncă (L18)
export async function registruRapoarteXlsx({ XLSX, client, list, siteNameOf, titluSite, from, to, generatLa }) {
  const vreme = await vremeExport(client, [...new Set(list.map(r => r.site_id))], { de: from, pana: to })
  return construiesteRapoarteXlsx({ XLSX, list, siteNameOf, titluSite, from, to, vreme, generatLa })
}
