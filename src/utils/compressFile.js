// ═══════════════════════════════════════════════════════════════
// compressFile.js — Utilitar compresie fișiere înainte de upload
// 05.06.2026 — Gazpet ERP
// ═══════════════════════════════════════════════════════════════
// Folosire: const fileDeUploadat = await compressFileBeforeUpload(file)
// ─────────────────────────────────────────────────────────────
// Imagini (JPG/PNG/WEBP): Canvas API → JPEG 82% quality, max 2048px
//   Reducere tipică: 40-70% din dimensiune originală
// PDF-uri: pdf-lib useObjectStreams → re-compresie stream-uri interne
//   Reducere tipică: 10-40% (mai mult pe PDF-uri neoptimizate)
//   REQUIRED: npm install pdf-lib în proiect
// ═══════════════════════════════════════════════════════════════

const IMAGE_MAX_PX   = 2048    // lățime/înălțime maximă după redimensionare
const IMAGE_QUALITY  = 0.82    // 82% quality JPEG — echilibru calitate/mărime
const IMAGE_MIN_SAVE = 0.85    // compresăm doar dacă reducem cu >15%

/**
 * Compresie imagine prin Canvas API.
 * Redimensionează dacă > IMAGE_MAX_PX și exportă ca JPEG.
 */
async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let w = img.naturalWidth
      let h = img.naturalHeight

      // Redimensionare proporțională dacă depășește limita
      if (w > IMAGE_MAX_PX || h > IMAGE_MAX_PX) {
        if (w >= h) { h = Math.round(h * IMAGE_MAX_PX / w); w = IMAGE_MAX_PX }
        else        { w = Math.round(w * IMAGE_MAX_PX / h); h = IMAGE_MAX_PX }
      }

      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url)
        if (!blob) { resolve(file); return }

        // Dacă compresia nu e semnificativă → returnăm originalul
        if (blob.size >= file.size * IMAGE_MIN_SAVE) {
          resolve(file)
          return
        }

        // Păstrăm extensia originală în nume dacă era deja JPEG, altfel .jpg
        const ext = file.type === 'image/jpeg' ? file.name : file.name.replace(/\.[^.]+$/, '.jpg')
        resolve(new File([blob], ext, { type: 'image/jpeg', lastModified: Date.now() }))
      }, 'image/jpeg', IMAGE_QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

/**
 * Compresie PDF prin pdf-lib.
 * Reușcrie stream-urile interne cu compresie maximă.
 * Fallback transparent dacă pdf-lib nu e instalat.
 */
async function compressPdf(file) {
  try {
    const { PDFDocument } = await import('pdf-lib')
    const bytes = await file.arrayBuffer()
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })

    const compressed = await doc.save({
      useObjectStreams: true,   // cross-reference streams comprimate
      addDefaultPage: false,
      objectsPerTick: 50,
    })

    const blob = new Blob([compressed], { type: 'application/pdf' })

    // Returnăm compresatul doar dacă e mai mic
    if (blob.size < file.size * IMAGE_MIN_SAVE) {
      return new File([blob], file.name, { type: 'application/pdf', lastModified: Date.now() })
    }
    return file
  } catch (_e) {
    // pdf-lib neinstalat sau PDF corupt → upload original fără eroare
    return file
  }
}

/**
 * Entry point principal.
 * Apelat înainte de orice supabase.storage.upload()
 *
 * @param {File} file — fișierul original de la input sau drop
 * @returns {Promise<File>} — fișierul comprimat (sau originalul dacă n-a ajutat)
 */
export async function compressFileBeforeUpload(file) {
  if (!file) return file

  if (file.type.startsWith('image/')) {
    return compressImage(file)
  }

  if (file.type === 'application/pdf') {
    return compressPdf(file)
  }

  // Alte tipuri (docx, xlsx etc.) — returnăm neatins
  return file
}

/**
 * Helper formatare dimensiune pentru log/toast
 * Ex: logCompressionResult(original, comprimat) → "2.4 MB → 980 KB (–59%)"
 */
export function logCompressionResult(original, compressed) {
  if (!original || !compressed) return ''
  const origKB  = (original.size  / 1024).toFixed(0)
  const compKB  = (compressed.size / 1024).toFixed(0)
  const pct     = Math.round((1 - compressed.size / original.size) * 100)
  const origStr = original.size  > 1024*1024 ? `${(original.size/1024/1024).toFixed(1)} MB` : `${origKB} KB`
  const compStr = compressed.size > 1024*1024 ? `${(compressed.size/1024/1024).toFixed(1)} MB` : `${compKB} KB`
  if (pct <= 0) return `${origStr} (necomprimat)`
  return `${origStr} → ${compStr} (–${pct}%)`
}
