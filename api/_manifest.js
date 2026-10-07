// R6 — manifestul de integritate SEAP, varianta Node (ruta Vercel /api/seap-import).
// Port 1:1 al supabase/functions/ofertare-seap-import/manifest.ts: aceleasi campuri,
// aceeasi cheie naturala UNIQUE (licitatie_id, arhiva_cheie, cale) -> upsert idempotent.
import { createHash } from 'node:crypto'

export const MANIFEST_CONFLICT = 'licitatie_id,arhiva_cheie,cale'
// cheia arhivei cand fisierul vine din DownloadArchive (identica cu edge, calea de rezerva)
export const ARHIVA_SEAP = 'seap:downloadarchive'

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')

// Pur: construieste randul (aceleasi reguli ca randManifest din manifest.ts).
export function randManifest(p) {
  const cheie = (s) => String(s ?? '').replace(/\.p7s$/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw new Error('sha256 invalid')
  if (!Number.isFinite(p.marime) || p.marime < 0) throw new Error('marime invalida')
  const cale = String(p.cale || '').replace(/\.p7s$/i, '')
  if (!cale) throw new Error('cale goala')
  return {
    licitatie_id: p.licitatieId,
    arhiva_cheie: p.arhivaCheie ? cheie(p.arhivaCheie) : cheie(cale),
    cale,
    marime: p.marime,
    sha256: p.sha256,
    document_id: p.documentId ?? null,
    stare: p.stare ?? (p.documentId ? 'urcat' : 'eroare_urcare'),
    motiv: p.motiv ?? null,
    verificat_la: (p.acum ?? new Date()).toISOString(),
  }
}

// Aceeasi cheie de 2 ori in acelasi upsert => Postgres refuza TOT lotul; pastram ultimul.
export const dedupManifest = (randuri) =>
  [...new Map(randuri.map((r) => [`${r.arhiva_cheie}\u0000${r.cale}`, r])).values()]
