// Adaptoarele gărzii de citire (docs/INGEST_GARDA.md) peste un client Supabase service_role.
// Logica e în gardaIngestLogica.ts (pură, testată cu vitest); aici doar apelurile RPC / Storage.
// Fail-CLOSED pe RPC-ul de gardă: dacă garda nu răspunde (migrare neaplicată, rețea), NU se descarcă —
// opusul monitorului de egress (fail-open), pentru că garda e condiția de reluare a citirii automate.
// deno-lint-ignore no-explicit-any
type Supa = any
import type { Decizie, MetaObiect } from './gardaIngestLogica.ts'

export async function metaObiect(supa: Supa, bucket: string, cale: string): Promise<MetaObiect | null> {
  try {
    const i = cale.lastIndexOf('/')
    const dir = i >= 0 ? cale.slice(0, i) : '', nume = cale.slice(i + 1)
    const { data, error } = await supa.storage.from(bucket).list(dir, { search: nume, limit: 100 })
    if (error || !Array.isArray(data)) return null
    const o = data.find((x: any) => x?.name === nume)
    if (!o?.metadata) return null
    return { size: o.metadata.size ?? null, etag: o.metadata.eTag ?? o.metadata.etag ?? null }
  } catch { return null }
}

export async function gardaIncearca(supa: Supa, docId: number, meta: MetaObiect | null, sursa: string): Promise<Decizie & { ingerat_hash?: string | null }> {
  try {
    const { data, error } = await supa.rpc('ofertare_ingest_garda_incearca', { p_doc_id: docId, p_size: meta?.size ?? null, p_etag: meta?.etag ?? null, p_sursa: sursa })
    if (error || !data?.actiune) return { actiune: 'blocat', motiv: 'garda indisponibilă: ' + (error?.message ?? 'răspuns gol') + ' — nu descarc' }
    return data
  } catch (e) { return { actiune: 'blocat', motiv: 'garda indisponibilă: ' + String((e as Error)?.message ?? e) + ' — nu descarc' } }
}

export async function gardaRezultat(supa: Supa, docId: number, r: { ok: boolean; incheiat?: boolean; hash?: string | null; size?: number | null; etag?: string | null; eroare?: string | null }): Promise<{ blocat?: boolean; motiv?: string } | null> {
  try {
    const { data, error } = await supa.rpc('ofertare_ingest_garda_rezultat', {
      p_doc_id: docId, p_ok: r.ok, p_incheiat: r.incheiat === true, p_hash: r.hash ?? null,
      p_size: r.size ?? null, p_etag: r.etag ?? null, p_eroare: r.eroare ?? null,
    })
    if (error) { console.warn('garda rezultat:', error.message); return null }
    return data
  } catch (e) { console.warn('garda rezultat:', (e as Error)?.message ?? e); return null }
}
