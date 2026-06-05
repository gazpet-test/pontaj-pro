// ═══════════════════════════════════════════════════════════════
// compressFile.js — Utilitar compresie fișiere înainte de upload
// 05.06.2026 — Gazpet ERP — fără dependențe externe
// ═══════════════════════════════════════════════════════════════
// Imagini (JPG/PNG/WEBP): Canvas API → JPEG 82% quality, max 2048px
//   Reducere tipică: 40-70%
// PDF-uri: returnate neatinse (compresie PDF necesită backend)
// ═══════════════════════════════════════════════════════════════

const IMAGE_MAX_PX  = 2048
const IMAGE_QUALITY = 0.82
const IMAGE_MIN_SAVE = 0.85  // compresăm doar dacă reducem cu >15%

async function compressImage(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      let w = img.naturalWidth
      let h = img.naturalHeight
      if (w > IMAGE_MAX_PX || h > IMAGE_MAX_PX) {
        if (w >= h) { h = Math.round(h * IMAGE_MAX_PX / w); w = IMAGE_MAX_PX }
        else        { w = Math.round(w * IMAGE_MAX_PX / h); h = IMAGE_MAX_PX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url)
        if (!blob || blob.size >= file.size * IMAGE_MIN_SAVE) { resolve(file); return }
        const ext = file.type === 'image/jpeg' ? file.name : file.name.replace(/\.[^.]+$/, '.jpg')
        resolve(new File([blob], ext, { type: 'image/jpeg', lastModified: Date.now() }))
      }, 'image/jpeg', IMAGE_QUALITY)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file) }
    img.src = url
  })
}

export async function compressFileBeforeUpload(file) {
  if (!file) return file
  if (file.type.startsWith('image/')) return compressImage(file)
  return file  // PDF și altele → neatinse
}

export function logCompressionResult(original, compressed) {
  if (!original || !compressed) return ''
  const pct = Math.round((1 - compressed.size / original.size) * 100)
  const fmt = s => s > 1048576 ? `${(s/1048576).toFixed(1)} MB` : `${(s/1024).toFixed(0)} KB`
  return pct > 0 ? `${fmt(original.size)} → ${fmt(compressed.size)} (–${pct}%)` : `${fmt(original.size)} (necomprimat)`
}
