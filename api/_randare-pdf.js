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
      // R4: dimensiunea paginii în puncte PDF (viewport scale 1) — pt proveniența pe regiune (_regiune, x0..y1 în pt)
      pagini.push({ total_pagini: doc.numPages, img: png, latime: w, inaltime: h, dpi: Math.round(zoom * 72), latime_pt: +vp1.width.toFixed(2), inaltime_pt: +vp1.height.toFixed(2) })
    }
  } finally { await doc.destroy() }
  return pagini
}

// ── R3 (25.09.2026): semnale structurale + dovada de siglă ──────────────────────────────────────────
// Semnalele NU sunt verdict: doar declanșează randarea paginii complete (ruta vectorială) în locul imaginii.
// R3 (Copilot): sigla se marchează DOAR prin IDENTIFICARE POZITIVĂ a conținutului imaginii selectate (fără AI):
//   raport ~2:1 ȘI latura mare <1000px ȘI conținut simplu (fond dominant + puține culori = text/logo) ȘI textul
//   pdf.js „EasySign/Semnat digital” are bbox-ul suprapus pe bbox-ul imaginii (aceeași regiune a paginii).
// Imagine mică (<10% din pagină) + conținut în afara bbox-ului rămâne DOAR declanșator de randare (dovada).
const RE_SEMNAT = /EasySign|Semnat digital|Digitally signed|Signature valid/i
const inm = (m1, m2) => [m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1], m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3], m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]]
const bboxUnitar = (m) => {
  const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]])
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

// Sonde de variație pe randarea paginii, EXCLUZÂND zona imaginii (+ margine). Întoarce câte sonde au desen.
function sondeInAfara(data, w, h, excl) {
  const pas = 8, raza = Math.max(6, Math.round(Math.min(w, h) / 40))
  let sonde = 0, cu = 0
  for (let r = 1; r < pas; r++) for (let c = 1; c < pas; c++) {
    const cx = Math.floor((c * w) / pas), cy = Math.floor((r * h) / pas)
    if (excl && cx + raza >= excl[0] && cx - raza <= excl[2] && cy + raza >= excl[1] && cy - raza <= excl[3]) continue
    sonde++
    let n = 0, s = 0, s2 = 0
    for (let y = Math.max(0, cy - raza); y < Math.min(h, cy + raza); y++)
      for (let x = Math.max(0, cx - raza); x < Math.min(w, cx + raza); x++) {
        const i = (y * w + x) * 4, v = (data[i] + data[i + 1] + data[i + 2]) / 3; n++; s += v; s2 += v * v
      }
    if (!n) continue
    const med = s / n
    if (Math.sqrt(Math.max(0, s2 / n - med * med)) > 2) cu++
  }
  return { sonde, cu_continut: cu }
}

// Conținut simplu (siglă/text): pe o miniatură de 128px — fondul dominant ≥60% din pixeli și ≤12 culori
// (cuantizate 3 biți/canal) cu pondere ≥0,5%. O planșă/fotografie are variație mare și multe tonuri.
export async function continutSimplu(imgBuf) {
  if (!imgBuf) return null
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(imgBuf, { failOn: 'none' }).resize({ width: 128, height: 128, fit: 'inside' })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const n = info.width * info.height, hist = new Map()
  for (let i = 0; i < n; i++) {
    const k = ((data[i * 3] >> 5) << 6) | ((data[i * 3 + 1] >> 5) << 3) | (data[i * 3 + 2] >> 5)
    hist.set(k, (hist.get(k) || 0) + 1)
  }
  const frecv = [...hist.values()].sort((a, b) => b - a)
  const fond = frecv[0] / n, culori = frecv.filter((c) => c / n >= 0.005).length
  return { fond: +fond.toFixed(3), culori, simplu: fond >= 0.6 && culori <= 12 }
}
const seSuprapun = (a, b, tol = 2) => a[0] <= b[2] + tol && b[0] <= a[2] + tol && a[1] <= b[3] + tol && b[1] <= a[3] + tol

// imgSel: {width,height} ale imaginii selectate de extractorul JPEG (se potrivește după dimensiunile în pixeli).
export async function analizeazaSemnale(buf, imgSel = null, imgBuf = null) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf), CanvasFactory: FabricaCanvas, disableFontFace: true, standardFontDataUrl: FONTURI,
    useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise
  try {
    const pag = await doc.getPage(1)
    const [vx0, vy0, vx1, vy1] = pag.view, ariaPag = Math.abs((vx1 - vx0) * (vy1 - vy0)) || 1
    const ops = await pag.getOperatorList()
    const O = pdfjs.OPS, IMG = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageXObjectRepeat].filter((x) => x != null))
    let ctm = [1, 0, 0, 1, 0, 0], stiva = [], paths = 0
    const imagini = [], pathBbox = []  // bbox-ul fiecărui path în coordonate PDF (minMax local × CTM)
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i], a = ops.argsArray[i]
      if (f === O.save) stiva.push(ctm)
      else if (f === O.restore) ctm = stiva.pop() || [1, 0, 0, 1, 0, 0]
      else if (f === O.transform) ctm = inm(ctm, a)
      else if (f === O.paintFormXObjectBegin) { stiva.push(ctm); if (Array.isArray(a?.[0]) && a[0].length === 6) ctm = inm(ctm, a[0]) }
      else if (f === O.paintFormXObjectEnd) ctm = stiva.pop() || [1, 0, 0, 1, 0, 0]
      else if (f === O.constructPath) {
        paths++
        const mm = a?.[2]
        if (Array.isArray(mm) && mm.length === 4 && mm.every(Number.isFinite)) {
          const bb = bboxUnitar([ctm[0] * (mm[2] - mm[0]), ctm[1] * (mm[2] - mm[0]), ctm[2] * (mm[3] - mm[1]), ctm[3] * (mm[3] - mm[1]),
            ctm[0] * mm[0] + ctm[2] * mm[1] + ctm[4], ctm[1] * mm[0] + ctm[3] * mm[1] + ctm[5]])
          pathBbox.push(bb)
        } else pathBbox.push(null) // necunoscut => tratat ca „în afară” (conservator)
      }
      else if (IMG.has(f)) {
        const w = f === O.paintInlineImageXObject ? a?.[0]?.width : a?.[1], h = f === O.paintInlineImageXObject ? a?.[0]?.height : a?.[2]
        const bb = bboxUnitar(ctm)
        imagini.push({ latime: w || null, inaltime: h || null, bbox_pdf: bb.map((v) => +v.toFixed(2)),
          fractie_pagina: +(((bb[2] - bb[0]) * (bb[3] - bb[1])) / ariaPag).toFixed(4) })
      }
    }
    const txt = await pag.getTextContent()
    const textSemnatura = RE_SEMNAT.test(txt.items.map((t) => t.str).join(' '))
    // bbox-ul fiecărui item de text în coordonate PDF (transform = [a,b,c,d,e,f], deja în spațiul paginii)
    const texte = txt.items.filter((t) => t.str && t.transform).map((t) => {
      const [a, b, , d, e, f] = t.transform, h = Math.abs(t.height || d || Math.hypot(a, b)) || 1, w = Math.abs(t.width || 0)
      return { str: t.str, bbox: [e, f - h * 0.25, e + w, f + h] }
    })
    const byteRange = /\/ByteRange\s*\[/.test(Buffer.from(buf).toString('latin1', 0, Math.min(buf.length, 8e6)))
    // imaginea efectiv selectată = cea cu aceleași dimensiuni în pixeli ca JPEG-ul ales; altfel cea mai mare afișată
    const sel = (imgSel && imagini.find((m) => m.latime === imgSel.width && m.inaltime === imgSel.height)) ||
      (imgSel ? null : [...imagini].sort((x, y) => y.fractie_pagina - x.fractie_pagina)[0]) || null
    const W = imgSel?.width || sel?.latime || 0, H = imgSel?.height || sel?.inaltime || 0
    const semnale = {
      raport_2_1_sub_1500: !!(W && H && Math.max(W, H) < 1500 && Math.abs(Math.max(W, H) / Math.min(W, H) - 2) < 0.2),
      imagine_sub_10_la_suta: !!(sel && sel.fractie_pagina < 0.10),
      paths_peste_500: paths > 500, text_semnatura: textSemnatura, byte_range: byteRange,
    }
    // Dovada: randare pagină completă (mică, ~1200px) și conținut în afara bbox-ului imaginii selectate
    let dovada = null
    if (sel && semnale.imagine_sub_10_la_suta) {
      const vp1 = pag.getViewport({ scale: 1 }), zoom = 1200 / Math.max(vp1.width, vp1.height), vp = pag.getViewport({ scale: zoom })
      const w = Math.ceil(vp.width), h = Math.ceil(vp.height), canvas = createCanvas(w, h), ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h)
      await pag.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise
      const r = vp.convertToViewportRectangle(sel.bbox_pdf), m = 4
      const excl = [Math.min(r[0], r[2]) - m, Math.min(r[1], r[3]) - m, Math.max(r[0], r[2]) + m, Math.max(r[1], r[3]) + m]
      const s = sondeInAfara(ctx.getImageData(0, 0, w, h).data, w, h, excl)
      dovada = { ...s, continut_in_afara: s.cu_continut >= Math.max(2, Math.ceil(s.sonde * 0.10)) }
    }
    pag.cleanup()
    // R4 (Copilot) pct. 1: conținut în afara bbox-ului imaginii selectate (path-uri, text, alte imagini), în coordonate
    // PDF, toleranță 2pt. Folosit la demonstrarea acoperirii și (paths_peste/text_peste, 25.09.2026) la rutare; nu la siglă.
    let acoperire_pdf = null
    if (sel) {
      const tol = 2, B = sel.bbox_pdf
      const inauntru = (bb) => !!bb && bb[0] >= B[0] - tol && bb[1] >= B[1] - tol && bb[2] <= B[2] + tol && bb[3] <= B[3] + tol
      acoperire_pdf = {
        fractie_pagina: sel.fractie_pagina,
        paths_in_afara: pathBbox.filter((bb) => !inauntru(bb)).length,
        text_in_afara: texte.filter((t) => t.str.trim() && !inauntru(t.bbox)).length,
        imagini_in_afara: imagini.filter((m) => m !== sel && !inauntru(m.bbox_pdf)).length,
        // conținut DESENAT PESTE imagine (cote, legendă) în interiorul bbox-ului => imaginea singură nu e toată planșa.
        // Textul de semnătură (EasySign / „Semnat digital”) nu contează ca suprapunere.
        paths_peste: pathBbox.filter((bb) => bb && inauntru(bb)).length,
        text_peste: texte.filter((t) => t.str.trim() && inauntru(t.bbox) && !RE_SEMNAT.test(t.str)).length,
      }
    }
    // Identificare POZITIVĂ (singura care poate da verdictul „siglă”)
    let identificare = null
    if (sel && W && H) {
      const raport = Math.max(W, H) / Math.min(W, H)
      const peImagine = texte.filter((t) => seSuprapun(t.bbox, sel.bbox_pdf))
      let simplu = null
      try { simplu = await continutSimplu(imgBuf) } catch (e) { simplu = { eroare: String(e?.message || e).slice(0, 80) } }
      identificare = {
        raport_2_1: Math.abs(raport - 2) < 0.2, sub_1000: Math.max(W, H) < 1000,
        continut_simplu: simplu?.simplu === true, metrici_continut: simplu,
        text_semnatura_pe_imagine: RE_SEMNAT.test(peImagine.map((t) => t.str).join(' ')),
      }
      identificare.dovedita = identificare.raport_2_1 && identificare.sub_1000 && identificare.continut_simplu && identificare.text_semnatura_pe_imagine
    }
    return {
      semnale, pagina_pdf: [vx0, vy0, vx1, vy1], paths, acoperire_pdf, imagini: imagini.slice(0, 20), imagine_selectata: sel, dovada, identificare,
      // declanșator de randare (NU verdict): imagine mică + conținut în afara bbox-ului
      declansator_randare: !!(semnale.imagine_sub_10_la_suta && dovada?.continut_in_afara),
      sursa_sigla_dovedita: identificare?.dovedita === true,
    }
  } finally { await doc.destroy() }
}
