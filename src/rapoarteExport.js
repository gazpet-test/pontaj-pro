// ===========================================================================
// rapoarteExport.js — export sumar Rapoarte Șantier (Faza 4)
//   - Excel (xlsx-js-style): un rând per raport, cu tot detaliul + antet.
//   - PDF (HTML → html2canvas → jsPDF, pattern FisaActivExport): sumar per
//     șantier pentru un interval — statistici agregate + tabel pe zile.
// Text liber (lucrări/probleme) e ESCAPAT înainte de randare (siguranță HTML).
// ===========================================================================

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import { supabase } from './lib/supabase.js'

const BUCKET = 'rapoarte-zilnice'
const blobToDataURL = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob) })
// Semnează + descarcă pozele ca data-URL (html2canvas + signed URL = CORS → convertim întâi)
async function pozeDataUrls(paths) {
  if (!paths || !paths.length) return []
  const out = []
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
  for (const s of (data || [])) {
    if (!s?.signedUrl) continue
    try { const r = await fetch(s.signedUrl); out.push(await blobToDataURL(await r.blob())) } catch (_) { /* poză lipsă → ignor */ }
  }
  return out
}

const PERSONAL_CAT = [
  ['sudori', 'Sudori'], ['lacatusi', 'Lăcătuși'], ['operatori', 'Operatori'],
  ['soferi', 'Șoferi'], ['necalificati', 'Necalif.'], ['tesa', 'TESA'], ['altii', 'Alții'],
]
const alimentate = (r) => utj(r).filter(u => u.alimentat).length
const fmtData = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
const esc = (s) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
const slug = (s) => String(s || 'santier').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 34) || 'santier'
const utj = (r) => Array.isArray(r.utilaje_snapshot) ? r.utilaje_snapshot : []
const nefunc = (r) => utj(r).filter(u => u.stare === 'nefunctional')

// ── EXCEL ──────────────────────────────────────────────────────────────────
export async function exportRapoarteExcel({ list, siteNameOf, titluSite, from, to }) {
  const XLSX = await import('xlsx-js-style')
  const thin = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  const headerStyle = { fill: { fgColor: { rgb: '1F3A5F' } }, font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: thin }
  const cellBase = { font: { name: 'Calibri', sz: 10 }, alignment: { vertical: 'top', wrapText: true }, border: thin }
  const COLS = 18

  const sorted = [...list].sort((a, b) => a.data.localeCompare(b.data))
  const aoa = [
    ['RAPOARTE ȘANTIER'],
    [`${titluSite}  •  ${from} → ${to}  •  Generat: ${new Date().toLocaleString('ro-RO')}  •  ${sorted.length} rapoarte`],
    [],
    ['Data', 'Șantier', 'Șef șantier', 'Sudori', 'Lăcătuși', 'Operatori', 'Șoferi', 'Necalif.', 'TESA', 'Alții', 'Total pers.', 'Utilaje/mașini', 'Alimentate', 'Nefuncț.', 'Lucrări efectuate', 'Mașini', 'Probleme', 'Plan mâine'],
  ]
  sorted.forEach(r => {
    const p = r.personal_snapshot || {}
    aoa.push([
      fmtData(r.data), siteNameOf(r.site_id), r.sef_santier || '—',
      p.sudori || 0, p.lacatusi || 0, p.operatori || 0, p.soferi || 0, p.necalificati || 0, p.tesa || 0, p.altii || 0, p.total || 0,
      utj(r).length, alimentate(r), nefunc(r).length,
      r.lucrari_efectuate || '', r.masini || '', r.probleme || '', r.plan_maine || '',
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
      if (c >= 3 && c <= 13) ws[ref].s.alignment = { ...cellBase.alignment, horizontal: 'center', vertical: 'center' }
    }
  }
  ws['!cols'] = [{ wch: 12 }, { wch: 26 }, { wch: 18 }, { wch: 7 }, { wch: 9 }, { wch: 9 }, { wch: 7 }, { wch: 8 }, { wch: 6 }, { wch: 6 }, { wch: 9 }, { wch: 13 }, { wch: 10 }, { wch: 8 }, { wch: 42 }, { wch: 22 }, { wch: 30 }, { wch: 30 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Rapoarte')
  XLSX.writeFile(wb, `Rapoarte_${slug(titluSite)}_${from}_${to}.xlsx`)
}

// ── PDF (sumar per șantier) ─────────────────────────────────────────────────
function buildRaportHtml({ list, titluSite, from, to }) {
  const sorted = [...list].sort((a, b) => a.data.localeCompare(b.data))
  const zile = sorted.length
  const omZile = sorted.reduce((s, r) => s + ((r.personal_snapshot || {}).total || 0), 0)
  const medie = zile ? (omZile / zile).toFixed(1) : '0'
  const utilProb = sorted.reduce((s, r) => s + nefunc(r).length, 0)
  const zileProbl = sorted.filter(r => (r.probleme || '').trim()).length

  const stat = (val, lbl) => `<div style="flex:1;text-align:center;padding:8px 6px;border:1px solid #dde3ea;border-radius:6px;background:#f7f9fc">
    <div style="font-size:20px;font-weight:800;color:#1F3A5F">${val}</div>
    <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.4px">${lbl}</div></div>`

  const rows = sorted.map(r => {
    const p = r.personal_snapshot || {}
    const nf = nefunc(r)
    const alim = alimentate(r)
    const persDetalii = PERSONAL_CAT.filter(([k]) => (p[k] || 0) > 0).map(([k, l]) => `${l}: ${p[k]}`).join(', ')
    const utilCell = `${utj(r).length}${alim ? ` <span style="color:#1F6FEB">⛽${alim}</span>` : ''}${nf.length ? ` <span style="color:#B42318">(${nf.length}✕)</span>` : ''}`
    const idUtilaj = (u) => [u.nume || u.cod || '?', [u.cod && u.nume ? u.cod : '', u.inmatriculare].filter(Boolean).join('/')].filter(Boolean).join(' ')
    const nfDetalii = nf.length ? `<div style="font-size:8px;color:#B42318;margin-top:2px">${nf.map(u => esc(idUtilaj(u) + (u.motiv ? ': ' + u.motiv : ''))).join(' · ')}</div>` : ''
    return `<tr>
      <td style="padding:4px 6px;border-bottom:1px solid #e8ecf1;white-space:nowrap;font-weight:600">${fmtData(r.data)}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e8ecf1;text-align:center">${p.total || 0}${persDetalii ? `<div style="font-size:8px;color:#888;margin-top:2px">${esc(persDetalii)}</div>` : ''}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e8ecf1;text-align:center">${utilCell}${nfDetalii}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e8ecf1">${esc(r.lucrari_efectuate || '—').replace(/\n/g, '<br/>')}</td>
      <td style="padding:4px 6px;border-bottom:1px solid #e8ecf1;color:#B4530B">${esc(r.probleme || '—').replace(/\n/g, '<br/>')}</td>
    </tr>`
  }).join('')

  return `<div style="width:760px;padding:24px;font-family:Arial,sans-serif;background:#fff;color:#111">
    <div style="display:flex;align-items:center;gap:12px;border-bottom:2px solid #1F3A5F;padding-bottom:8px;margin-bottom:12px">
      <img src="${LOGO_B64}" style="height:42px"/>
      <div style="flex:1">
        <div style="font-size:16px;font-weight:800">RAPORT SUMAR ȘANTIER</div>
        <div style="font-size:12px;color:#1F3A5F;font-weight:700">${esc(titluSite)}</div>
      </div>
      <div style="font-size:9px;color:#777;text-align:right">Gazpet Instal SRL<br/>perioada ${fmtData(from)} – ${fmtData(to)}<br/>generat ${new Date().toLocaleDateString('ro-RO')}</div>
    </div>

    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${stat(zile, 'Zile raportate')}
      ${stat(omZile, 'Oameni-zile')}
      ${stat(medie, 'Medie oameni/zi')}
      ${stat(utilProb, 'Utilaje cu probleme')}
      ${stat(zileProbl, 'Zile cu probleme')}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:9.5px">
      <thead><tr>
        <th style="background:#1F3A5F;color:#fff;padding:5px 6px;text-align:left;width:12%">Data</th>
        <th style="background:#1F3A5F;color:#fff;padding:5px 6px;text-align:center;width:12%">Personal</th>
        <th style="background:#1F3A5F;color:#fff;padding:5px 6px;text-align:center;width:14%">Utilaje</th>
        <th style="background:#1F3A5F;color:#fff;padding:5px 6px;text-align:left;width:37%">Lucrări efectuate</th>
        <th style="background:#1F3A5F;color:#fff;padding:5px 6px;text-align:left;width:25%">Probleme</th>
      </tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#888">Niciun raport în interval.</td></tr>'}</tbody>
    </table>

    ${sorted.some(r => r._pozeData?.length) ? `
    <div style="margin-top:16px">
      <div style="background:#1F3A5F;color:#fff;padding:5px 8px;font-size:11px;font-weight:700">📷 POZE DE PE ȘANTIER</div>
      ${sorted.filter(r => r._pozeData?.length).map(r => `
        <div style="margin-top:10px">
          <div style="font-size:10px;font-weight:700;color:#1F3A5F;margin-bottom:5px">${fmtData(r.data)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${r._pozeData.map(u => `<img src="${u}" style="width:238px;height:170px;object-fit:cover;border:1px solid #ccc;border-radius:4px"/>`).join('')}
          </div>
        </div>`).join('')}
    </div>` : ''}

    <div style="margin-top:14px;font-size:8px;color:#888;border-top:1px solid #ddd;padding-top:6px">
      Document generat automat din PontajPRO · Gazpet Instal SRL · ${zile} rapoarte zilnice
    </div>
  </div>`
}

export async function exportRapoartePDF({ list, titluSite, from, to }) {
  // descarcă pozele fiecărui raport ca data-URL (înainte de randare)
  for (const r of list) r._pozeData = await pozeDataUrls(r.poze)
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = buildRaportHtml({ list, titluSite, from, to })
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff' })
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const w = 190, h = (canvas.height * w) / canvas.width
    const pageH = 277
    let rest = h, y = 0
    while (rest > 0) {
      const partH = Math.min(pageH, rest)
      const part = document.createElement('canvas')
      part.width = canvas.width
      part.height = (partH / h) * canvas.height
      part.getContext('2d').drawImage(canvas, 0, (y / h) * canvas.height, canvas.width, part.height, 0, 0, canvas.width, part.height)
      if (y > 0) pdf.addPage()
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, partH)
      y += partH; rest -= partH
    }
    pdf.save(`Raport_${slug(titluSite)}_${from}_${to}.pdf`)
  } finally {
    document.body.removeChild(host)
  }
}
