// ===========================================================================
// PV predare-primire din aviz (TKT-2026-0379) — randarea PDF, descărcat LOCAL.
// Tiparul casei: HTML în afara ecranului → 2× requestAnimationFrame → html2canvas → jsPDF A4.
// Nu urcă nimic în Storage și nu scrie în BD.
// r2 (L24): `esteCurent()` se verifică după citiri, înainte de captură, după captură și înainte de descărcare;
// operația invalidată (ecran închis) se oprește cu { ok:false, anulat:true }, fără PDF.
// ===========================================================================

import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import { ziBucuresti } from './adminAlerte.js'
import { incarcaDatePv, construiesteHtmlPv, numeFisierPv } from './pvPredareAviz.js'

const ANULAT = Object.freeze({ ok: false, anulat: true })
const mereuCurent = () => true

// `unelte` există doar pentru teste (document / cadre / captură / PDF înlocuite); în aplicație rămân cele reale.
export async function genereazaPvPredareAviz({ supabase, aviz, esteCurent = mereuCurent, unelte = {} }) {
  const doc = unelte.document || globalThis.document
  const cadru = unelte.requestAnimationFrame || ((f) => globalThis.requestAnimationFrame(f))
  const captura = unelte.html2canvas || html2canvas
  const PDF = unelte.jsPDF || jsPDF

  const date = await incarcaDatePv(supabase, aviz)
  if (!esteCurent()) return ANULAT
  if (!date.ok) return date

  const html = construiesteHtmlPv({
    aviz, linii: date.linii, firma: date.firma, logo: LOGO_B64,
    dataPv: aviz.data_transport || ziBucuresti(),
  })

  const host = doc.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;background:#fff'
  host.innerHTML = html
  doc.body.appendChild(host)
  let canvas
  try {
    await new Promise(r => cadru(() => cadru(r)))
    if (!esteCurent()) return ANULAT
    canvas = await captura(host.firstElementChild, { scale: 2, backgroundColor: '#FFFFFF', logging: false, useCORS: true })
  } finally {
    doc.body.removeChild(host)
  }
  if (!esteCurent()) return ANULAT

  // A4 cu margini de 10 mm: 190 mm lățime utilă ↔ 738 px în HTML.
  const pdf = new PDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const w = 190, pageH = 277
  const h = (canvas.height * w) / canvas.width
  let rest = h, y = 0
  while (rest > 0.5) {
    const partH = Math.min(pageH, rest)
    const parte = doc.createElement('canvas')
    parte.width = canvas.width
    parte.height = Math.max(1, Math.round((partH / h) * canvas.height))
    parte.getContext('2d').drawImage(canvas, 0, Math.round((y / h) * canvas.height), canvas.width, parte.height, 0, 0, canvas.width, parte.height)
    if (y > 0) pdf.addPage()
    pdf.addImage(parte.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w, partH, undefined, 'FAST')
    y += partH; rest -= partH
  }

  // Ultima verificare chiar înaintea descărcării (construirea paginilor poate dura la PV-uri lungi).
  if (!esteCurent()) return ANULAT
  const fisier = numeFisierPv(aviz)
  pdf.save(fisier)
  return { ok: true, fisier, nrLinii: date.linii.length }
}
