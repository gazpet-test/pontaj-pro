// R6 — manifestul de integritate SEAP scris și de edge (nu doar de workerul Terra).
// Aceleași câmpuri ca worker/ofertare/seap.ts (ManifestRand), cheia naturală
// UNIQUE (licitatie_id, arhiva_cheie, cale) → upsert idempotent.
export type StareManifest = 'urcat' | 'deja_in_platforma' | 'eroare_urcare' | 'ignorat'
export type ManifestRand = {
  licitatie_id: number; arhiva_cheie: string; cale: string; marime: number; sha256: string
  document_id: number | null; stare: StareManifest; motiv: string | null; verificat_la: string
}
export const MANIFEST_CONFLICT = 'licitatie_id,arhiva_cheie,cale'

export async function sha256Hex(buf: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('')
}

// Pur: construiește rândul. arhiva_cheie = cheia documentului SEAP (fără .p7s, lowercase);
// pentru un fișier simplu (nu arhivă) arhiva_cheie = cheia lui însuși, cale = numele lui.
export function randManifest(p: {
  licitatieId: number; arhivaCheie: string | null | undefined; cale: string; marime: number; sha256: string
  documentId?: number | null; stare?: StareManifest; motiv?: string | null; acum?: Date
}): ManifestRand {
  const cheie = (s: string) => String(s ?? '').replace(/\.p7s$/i, '').toLowerCase()
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
