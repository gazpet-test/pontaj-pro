// PDF „Raport lucrări executate" (distribuție gaze) — A4 landscape, ca formularul de hârtie.
// HTML → html2canvas → jsPDF (pattern rapoarteExport.js). Folosit din mobil (/m) și din desktop (Rapoarte șantier).
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import { buildHtml, numeFisier } from './raportDistributie.js'

export async function exportRaportDistributiePDF({ antet, data, linii, unitati, lucrare }) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0'
  host.innerHTML = buildHtml({ antet, data, linii, unitati, lucrare })
  document.body.appendChild(host)
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#fff' })
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
    // pagină 297×210 mm, margini 10 mm; dacă formularul e mai înalt decât pagina, îl micșorăm proporțional
    let w = 277, h = (canvas.height * w) / canvas.width
    if (h > 190) { w = w * 190 / h; h = 190 }
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (297 - w) / 2, 10, w, h)
    pdf.save(numeFisier({ lucrare, data }))
  } finally {
    document.body.removeChild(host)
  }
}
