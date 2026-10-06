// ofertare-document-nou-citeste/obiect.ts — identitatea obiectului din Storage citit pe calea PDF (Copilot conv. 3, 06.10, P1).
// Ca la J04: instantaneu înainte și după descărcare (id + updated_at + eTag + mărime), SHA-256 pe bytes-ii efectiv descărcați,
// apoi încă o comparație chiar înainte de scriere — fișierul rescris la aceeași cale în timpul apelului AI => nimic scris.
// deno-lint-ignore no-explicit-any
type Supa = any
export type IdentitateObiect = { id: string | null; updated_at: string | null; etag: string | null; size: number | null }

export async function identitateObiect(supa: Supa, bucket: string, cale: string): Promise<IdentitateObiect | null> {
  try {
    const i = cale.lastIndexOf('/')
    const dir = i >= 0 ? cale.slice(0, i) : '', nume = cale.slice(i + 1)
    const { data, error } = await supa.storage.from(bucket).list(dir, { search: nume, limit: 100 })
    if (error || !Array.isArray(data)) return null
    const o = data.find((x: any) => x?.name === nume)
    if (!o?.metadata) return null
    return { id: o.id ?? null, updated_at: o.updated_at ?? null, etag: o.metadata.eTag ?? o.metadata.etag ?? null, size: o.metadata.size ?? null }
  } catch { return null }
}

// Aceeași identitate = toate câmpurile egale ȘI cel puțin eTag sau updated_at prezente (altfel nu avem ce compara => fail-closed).
export function aceeasiIdentitate(a: IdentitateObiect | null, b: IdentitateObiect | null): boolean {
  if (!a || !b) return false
  if (a.etag == null && a.updated_at == null) return false
  return a.id === b.id && a.updated_at === b.updated_at && a.etag === b.etag && a.size === b.size
}

export async function shaOcteti(b: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource)), (x) => x.toString(16).padStart(2, '0')).join('')
}
