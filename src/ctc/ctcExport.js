// ════════════════════════════════════════════════════════════════
// ctcExport.js — Borderou PDF (html2canvas + jsPDF, pattern avize) și ZIP cu documentele cărții.
// jsPDF / html2canvas / JSZip se încarcă DINAMIC: CTC.jsx e importat static din App.jsx și nu vrem
// să umflăm bundle-ul principal. Concatenarea PDF-urilor într-un singur PDF = F2 (Edge Function, pdf-lib).
// html2canvas: colgroup în PROCENTE (A4 util = 738px), 2x requestAnimationFrame înainte de capture.
// ════════════════════════════════════════════════════════════════
import { supabase } from '../lib/supabase.js'
import { RANDURI_PE_PAGINA_BORDEROU, etichetaTronson, numeInZip, slugFisier } from './ctcUtil.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function paginaHtml({ carte, randuri, index, totalPaginiB, prima, ultima, intocmitDe, totalCarte, faraPagini }) {
  const rows = randuri.map(r => {
    const pag = r.start ? (r.start === r.end ? `${r.start}` : `${r.start} – ${r.end}`) : '—'
    return `<tr style="height:26px;vertical-align:middle">
      <td style="text-align:center;border:1px solid #999">${r.nr}</td>
      <td style="border:1px solid #999;padding:0 5px"><div style="max-height:26px;overflow:hidden;line-height:13px">${esc(r.doc.denumire_document)}</div></td>
      <td style="text-align:center;border:1px solid #999">${pag}</td>
      <td style="border:1px solid #999;padding:0 5px"><div style="max-height:26px;overflow:hidden;line-height:13px">${esc(r.doc.tronson ? etichetaTronson(r.doc.tronson) : '')}</div></td>
    </tr>`
  }).join('')
  const antet = prima ? `
    <div style="font-size:11px;font-weight:700">S.C. GAZPET INSTAL S.R.L. — Ploiești</div>
    <div style="text-align:center;font-size:17px;font-weight:800;margin:14px 0 10px">Borderou centralizator cu documentele cuprinse în Cartea Tehnică</div>
    <div style="font-size:12px;line-height:17px;margin-bottom:10px">
      <b>Beneficiar:</b> ${esc(carte.beneficiar_nume || '—')}<br>
      <b>Obiectiv:</b> ${esc(carte.denumire_obiectiv)}<br>
      <b>Contract:</b> ${esc(carte.numar_contract || '—')}${carte.data_contract ? ' / ' + new Date(carte.data_contract).toLocaleDateString('ro-RO') : ''}
      ${carte.localitate || carte.judet ? `<br><b>Amplasament:</b> ${esc([carte.localitate, carte.judet].filter(Boolean).join(', '))}` : ''}
    </div>` : `<div style="font-size:10px;color:#555;margin-bottom:8px">${esc(carte.denumire_obiectiv)} — continuare borderou</div>`
  const subsol = ultima ? `
    <div style="margin-top:14px;font-size:11px">
      <b>Total pagini în carte (cu borderou):</b> ${faraPagini ? '— (există poziții fără număr de pagini)' : totalCarte}
    </div>
    <div style="margin-top:18px;font-size:12px;display:flex;justify-content:space-between">
      <div>Întocmit de: <b>${esc(intocmitDe || '')}</b><br>Funcția: CTC</div><div>Semnătura: ____________________</div>
    </div>` : ''
  return `<div style="width:794px;height:1123px;padding:28px 28px 20px;box-sizing:border-box;background:#fff;color:#000;font-family:Arial,Helvetica,sans-serif;position:relative">
    <div style="position:absolute;top:10px;right:28px;font-size:9px;color:#666">Borderou — pagina ${index + 1}/${totalPaginiB}</div>
    ${antet}
    <table style="width:100%;border-collapse:collapse;font-size:10.5px;table-layout:fixed">
      <colgroup><col style="width:7%"><col style="width:55%"><col style="width:16%"><col style="width:22%"></colgroup>
      <thead><tr style="height:24px;background:#eee"><th style="border:1px solid #999">Nr. crt.</th><th style="border:1px solid #999">Denumirea documentului</th><th style="border:1px solid #999">Pagina</th><th style="border:1px solid #999">Tronson / probă</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${subsol}
  </div>`
}

// → Blob PDF (A4). `borderou` = rezultatul calculeazaBorderou(docs, paginiBorderou).
export async function genereazaBorderouPdf({ carte, borderou, intocmitDe }) {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')])
  const chunkuri = []
  for (let i = 0; i < borderou.randuri.length; i += RANDURI_PE_PAGINA_BORDEROU) chunkuri.push(borderou.randuri.slice(i, i + RANDURI_PE_PAGINA_BORDEROU))
  if (!chunkuri.length) chunkuri.push([])
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = chunkuri.map((randuri, i) => paginaHtml({
    carte, randuri, index: i, totalPaginiB: chunkuri.length, prima: i === 0, ultima: i === chunkuri.length - 1,
    intocmitDe, totalCarte: borderou.totalPagini, faraPagini: borderou.faraPagini,
  })).join('')
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    for (let i = 0; i < host.children.length; i++) {
      const canvas = await html2canvas(host.children[i], { scale: 2, backgroundColor: '#fff' })
      if (i > 0) pdf.addPage()
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297)
    }
    return pdf.output('blob')
  } finally { document.body.removeChild(host) }
}

export function descarcaBlob(blob, nume) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = nume
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

// ZIP: 000_Borderou.pdf + câte un fișier per poziție, numerotat ca în borderou. Descărcare secvențială
// (un fișier în memorie odată, pe lângă ZIP) cu progres; fișierele care nu pot fi citite se raportează, nu opresc exportul.
export async function construiesteZip({ carte, borderou, borderouBlob, onProgres }) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  if (borderouBlob) zip.file('000_Borderou.pdf', borderouBlob)
  const esuate = []
  const total = borderou.randuri.length
  for (let i = 0; i < total; i++) {
    const r = borderou.randuri[i]
    onProgres?.(i + 1, total, r.doc.denumire_document)
    const { data, error } = await supabase.storage.from(r.doc.fisier_bucket).download(r.doc.fisier_path)
    if (error || !data) { esuate.push(`${r.nr}. ${r.doc.denumire_document}: ${error?.message || 'fără date'}`); continue }
    zip.file(numeInZip(r.nr, r.doc.denumire_document, r.doc.tronson), data)
  }
  if (esuate.length) zip.file('000_EROARE_fisiere_necitite.txt', 'Aceste poziții nu au putut fi descărcate:\n' + esuate.join('\n'))
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })   // PDF-urile sunt deja comprimate
  return { blob, esuate, nume: `CTC_${slugFisier(carte.denumire_obiectiv, 50)}.zip` }
}
