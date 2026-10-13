// Logică pură pentru ingest-document (fără Deno/Supabase) — testată cu vitest.

export const SLUG_DE_REPARTIZAT = '_de_repartizat'

// Candidații vin din scriptul Gmail ca listă de etichete (array sau text separat prin virgulă / „;”).
// Curățăm, deduplicăm (fără diferențe de majuscule), limităm la 20 × 80 de caractere.
export function parseCandidati(v) {
  const brut = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;]/) : []
  const vazut = new Set(), out = []
  for (const x of brut) {
    const s = String(x ?? '').replace(/^Automatizari\//i, '').trim().slice(0, 80)
    if (!s || vazut.has(s.toLowerCase())) continue
    vazut.add(s.toLowerCase()); out.push(s)
    if (out.length >= 20) break
  }
  return out
}

export const esteDeRepartizat = (slug) => String(slug || '').trim().toLowerCase() === SLUG_DE_REPARTIZAT

// Comparare în timp constant (secret gol/lipsă → false).
export function egalConstant(primit, secret) {
  if (typeof primit !== 'string' || typeof secret !== 'string' || !secret) return false
  const enc = new TextEncoder()
  const a = enc.encode(primit), b = enc.encode(secret)
  let diff = a.length ^ b.length
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i]
  return diff === 0
}

// Cheie Storage sigură: fără diacritice, doar ASCII permis.
export const storageKeySafe = (name) =>
  String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
    .slice(0, 160) || 'fisier'

// data_mail invalidă (sau lipsă) → acum, fără RangeError la toISOString (Copilot P1-3).
export function dataSigura(v) {
  const d = v ? new Date(v) : new Date()
  return isNaN(d.getTime()) ? new Date() : d
}

export function caleStorage({ prefix, dataMail, messageId, numeFisier }) {
  const d = dataMail instanceof Date && !isNaN(dataMail) ? dataMail : new Date()
  const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${prefix}/${yyyy}/${mm}/${String(messageId).slice(-8)}_${storageKeySafe(numeFisier)}`
}
