// ===========================================================================
// PV predare-primire din aviz (TKT-2026-0379) — randarea PDF, descărcat LOCAL.
// Tiparul casei: HTML în afara ecranului → 2× requestAnimationFrame → html2canvas → jsPDF A4.
// Nu urcă nimic în Storage și nu scrie în BD.
// ===========================================================================

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import { ziBucuresti } from './adminAlerte.js'
import { incarcaDatePv, construiesteHtmlPv, numeFisierPv } from './pvPredareAviz.js'

export async function genereazaPvPredareAviz({ supabase, aviz }) {
  const date = await incarcaDatePv(supabase, aviz)
  if (!date.ok) return date

  const html = construiesteHtmlPv({
    aviz, linii: date.linii, firma: date.firma, logo: LOGO_B64,
    dataPv: aviz.data_transport || ziBucuresti(),
  })

  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff'
  host.innerHTML = html
  document.body.appendChild(host)
  let canvas
  try {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    canvas = await html2canvas(host.firstElementChild, { scale: 2, backgroundColor: '#FFFFFF', logging: false, useCORS: true })
  } finally {
    document.body.removeChild(host)
  }

  // A4 cu margini de 10 mm: 190 mm lățime utilă ↔ 738 px în HTML.
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const w = 190, pageH = 277
  const h = (canvas.height * w) / canvas.width
  let rest = h, y = 0
  while (rest > 0.5) {
    const partH = Math.min(pageH, rest)
    const parte = document.createElement('canvas')
    parte.width = canvas.width
    parte.height = Math.max(1, Math.round((partH / h) * canvas.height))
    parte.getContext('2d').drawImage(canvas, 0, Math.round((y / h) * canvas.height), canvas.width, parte.height, 0, 0, canvas.width, parte.height)
    if (y > 0) pdf.addPage()
    pdf.addImage(parte.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, partH, undefined, 'FAST')
    y += partH; rest -= partH
  }

  const fisier = numeFisierPv(aviz)
  pdf.save(fisier)
  return { ok: true, fisier, nrLinii: date.linii.length }
}
