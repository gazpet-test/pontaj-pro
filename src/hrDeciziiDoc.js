// ════════════════════════════════════════════════════════════════
// Registrul deciziilor HR — generarea documentului în browser (spec docs/HR/GENERATOR_DECIZII_SPEC.md §6, PR2).
//  • renderDecizieHtml   — pagina A4 (794×1123) din `continut`, doar prin escapare (J3-8)
//  • masoaraDecizie      — înălțimea corpului la 12pt și 11pt; alegerea fontului (B7, Vf8)
//  • renderDeciziePdf    — PDF A4 nedeformat, la fontul înghețat în snapshot.font_pt (J2-3)
//  • pregatestePagina + paginiToPdf — scanul semnat din poze → UN singur PDF A4, în ordine, fără EXIF (D5, VA27, VA28)
//  • sha256Hex           — amprenta DECLARATĂ la încărcare (VA38), reexportată din ofertarePachet.js
// Fără librării noi: jspdf + html2canvas sunt deja în proiect. renderHtmlToPdfBlob din Achizitii.jsx NU se importă
// (ar trage modulul Achiziții în chunk-ul HR, iar holder-ul de acolo nu are înălțimea fixă cerută de C18).
// ════════════════════════════════════════════════════════════════
import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas'
import LOGO_B64 from './logo.js'
import { sha256Hex } from './ofertarePachet.js'
import { PAGINA, INALTIME_CORP, FONTURI, asezareA4, dimensiuniCanvas, alegeFont, estePdf, renderDecizieHtml as renderPur } from './hrDeciziiUtil.js'

export { sha256Hex }

/** Pagina de decizie: `continut` de la server + snapshot (fontul înghețat) + {cod_verificare, previzualizare, fontPt}. */
export function renderDecizieHtml(continut, snapshot, opts = {}) {
  return renderPur(continut, { ...opts, logo: LOGO_B64, fontPt: opts.fontPt ?? snapshot?.font_pt })
}

const dublaCadru = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

async function cuHolder(html, fn) {
  const holder = document.createElement('div')
  holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${PAGINA.w}px;height:${PAGINA.h}px;overflow:hidden;background:#ffffff;z-index:-1;`
  holder.innerHTML = html
  document.body.appendChild(holder)
  try {
    await Promise.all(Array.from(holder.querySelectorAll('img')).map(i => (i.decode ? i.decode().catch(() => {}) : null)))
    if (document.fonts?.ready) await document.fonts.ready
    await dublaCadru()
    return await fn(holder)
  } finally {
    document.body.removeChild(holder)
  }
}

const inaltimeCorp = holder => holder.querySelector('.hrdec-corp')?.scrollHeight ?? Infinity

/**
 * Măsoară corpul la fiecare font permis. Întoarce { fontPt: 12|11|null, inaltimi: {12, 11}, limita }.
 * fontPt = null ⇒ textul nu încape pe o pagină ⇒ „Emite” rămâne blocat (B7). La previzualizare, `continut.nr`
 * e numărul-rezervă de lățime maximă (J20), deci numărul final nu poate schimba încadrarea.
 */
export async function masoaraDecizie(continut, opts = {}) {
  const inaltimi = {}
  for (const f of FONTURI) {
    inaltimi[f] = await cuHolder(renderPur(continut, { ...opts, logo: LOGO_B64, fontPt: f }), inaltimeCorp)
    if (inaltimi[f] <= INALTIME_CORP) break
  }
  return { fontPt: alegeFont(inaltimi), inaltimi, limita: INALTIME_CORP }
}

/**
 * PDF-ul final (sau previzualizarea) — o pagină A4 nedeformată, canvas 794:1123 (C18).
 * Fontul vine din snapshot.font_pt (înghețat la emitere) sau din opts.fontPt la previzualizare; nu se alege aici.
 * Un document care depășește pagina aruncă eroare și NU se urcă (§4.A.4, J20).
 */
export async function renderDeciziePdf(continut, snapshot, opts = {}) {
  const fontPt = opts.fontPt ?? snapshot?.font_pt
  if (!FONTURI.includes(fontPt)) throw new Error('Fontul deciziei lipsește (snapshot.font_pt trebuie să fie 12 sau 11)')
  const html = renderPur(continut, { ...opts, logo: LOGO_B64, fontPt })
  return cuHolder(html, async holder => {
    const h = inaltimeCorp(holder)
    if (h > INALTIME_CORP) throw new Error(`Decizia depășește o pagină A4 (${h}px > ${INALTIME_CORP}px la ${fontPt}pt) — nu se urcă`)
    const canvas = await html2canvas(holder, { scale: 2, width: PAGINA.w, height: PAGINA.h, backgroundColor: '#ffffff', logging: false })
    if (canvas.width * PAGINA.h !== canvas.height * PAGINA.w) throw new Error(`Pagina randată nu are raport A4 (${canvas.width}×${canvas.height})`)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST')
    canvas.width = canvas.height = 0
    return doc.output('blob')
  })
}

/** Blob → File PDF cu nume stabil (ex. decizie_916_2026.pdf). */
export const fisierPdf = (blob, nume) => new File([blob], nume, { type: 'application/pdf' })

// ─── Scanul semnat din poze (D5) ───────────────────────────────

/**
 * O poză → pagină pregătită { dataUrl, w, h } (JPEG 85%, max 2400px pe latura lungă, fundal alb, rotită 0/90/180/270).
 * Decodare cu object URL + img.decode() (nu FileReader → dataURL, care dublează memoria la poze de 10–25 MB).
 * Redesenarea pe canvas scoate EXIF/GPS. ⟳ se re-randează din File-ul ORIGINAL, nu din pagina comprimată.
 * Imagine nedecodabilă (ex. HEIC pe Android/desktop) ⇒ eroare cu numele fișierului, fără fallback.
 */
export async function pregatestePagina(file, rot = 0) {
  const url = URL.createObjectURL(file)
  const canvas = document.createElement('canvas')
  try {
    const img = new Image()
    img.src = url
    try { await img.decode() } catch { throw new Error(`Imaginea „${file?.name || 'fără nume'}” nu poate fi citită de browser (format nesuportat?)`) }
    const w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) throw new Error(`Imaginea „${file?.name || 'fără nume'}” nu are dimensiuni`)
    const { cw, ch } = dimensiuniCanvas(w, h, rot)
    canvas.width = cw; canvas.height = ch
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch)
    ctx.translate(cw / 2, ch / 2)
    ctx.rotate((((Number(rot) % 360) + 360) % 360) * Math.PI / 180)
    const r = ((Number(rot) % 360) + 360) % 360
    const [dw, dh] = r === 90 || r === 270 ? [ch, cw] : [cw, ch]
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), w: cw, h: ch }
  } finally {
    canvas.width = canvas.height = 0            // limita de memorie pentru canvas din Safari iOS
    URL.revokeObjectURL(url)
  }
}

/**
 * Paginile pregătite → UN singur File `semnat_<ts>.pdf`, o pagină A4 (mm, nu px) pe imagine, în ordinea primită,
 * imaginea centrată fără deformare (asezareA4). jsPDF pune un File ID aleator ⇒ același set dă alt hash: nu se recompune la retry.
 */
export function paginiToPdf(pagini) {
  if (!Array.isArray(pagini) || !pagini.length) throw new Error('Nicio pagină de pus în PDF')
  let doc = null
  pagini.forEach((p, i) => {
    const a = asezareA4(p.w, p.h, 0)
    if (!doc) doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: a.orientare, compress: true })
    else doc.addPage('a4', a.orientare)
    if (!/^data:image\/jpeg;base64,/.test(p.dataUrl || '')) throw new Error(`Pagina ${i + 1} nu e pregătită`)
    doc.addImage(p.dataUrl, 'JPEG', a.x, a.y, a.l, a.h, undefined, 'FAST')
  })
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_')
  return new File([doc.output('blob')], `semnat_${ts}.pdf`, { type: 'application/pdf' })
}

/**
 * Un PDF ales din Fișiere: unele telefoane dau `type` gol. Se verifică semnătura „%PDF-” și se reîmpachetează
 * ca application/pdf (VA32). Altceva decât PDF ⇒ eroare.
 */
export async function normalizeazaPdf(file) {
  const cap = new Uint8Array(await file.slice(0, 5).arrayBuffer())
  if (!estePdf(cap)) throw new Error(`„${file?.name || 'fișierul'}” nu e PDF`)
  return file.type === 'application/pdf' ? file : new File([file], file.name || 'scan.pdf', { type: 'application/pdf' })
}
