// 25.09.2026: randarea planșelor VECTORIALE (text convertit în curbe, fără scanare) — pdf.js + @napi-rs/canvas.
// Înlocuiește MuPDF (licență AGPL, risc pe o platformă folosită prin internet). pdf.js = Apache-2.0,
// @napi-rs/canvas = MIT; binarul nativ are build pt Linux x64 (Vercel Node).
import { createCanvas } from '@napi-rs/canvas'
import { createRequire } from 'node:module'
import path from 'node:path'

// fonturile standard PDF (Helvetica etc. neîncorporate) — altfel textul real din planșă nu apare
const FONTURI = path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/'

class FabricaCanvas {
  create(w, h) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext('2d') } }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}

export const DPI_VECTOR = 200          // A0/A1 la 200 dpi => cotele (text 1.5–2mm) au ~12–16px
const MAX_LATURA_RANDARE = 12000       // plafon pe latura randată (memorie)
const MAX_PAGINI_VECTOR = 6

// dpi: implicit 200; „recitește fin" cere 300 (tot sub plafonul de latură)
export async function randeazaVectorial(buf, dpi = DPI_VECTOR) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), CanvasFactory: FabricaCanvas, disableFontFace: true, standardFontDataUrl: FONTURI,
    useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise
  const pagini = []
  try {
    const n = Math.min(doc.numPages, MAX_PAGINI_VECTOR)
    for (let i = 1; i <= n; i++) {
      const pag = await doc.getPage(i)
      const vp1 = pag.getViewport({ scale: 1 })
      const zoom = Math.min(dpi / 72, MAX_LATURA_RANDARE / Math.max(vp1.width, vp1.height))
      const vp = pag.getViewport({ scale: zoom })
      const w = Math.ceil(vp.width), h = Math.ceil(vp.height)
      const canvas = createCanvas(w, h)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
      await pag.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise
      const png = await canvas.encode('png')
      pag.cleanup()
      pagini.push({ img: png, latime: w, inaltime: h, dpi: Math.round(zoom * 72) })
    }
  } finally { await doc.destroy() }
  return pagini
}
