// Adaptoarele gărzii de citire (docs/INGEST_GARDA.md) peste un client Supabase service_role.
// Logica e în gardaIngestLogica.ts (pură, testată cu vitest); aici doar apelurile RPC / Storage.
// Fail-CLOSED pe RPC-ul de gardă: dacă garda nu răspunde (migrare neaplicată, rețea) sau răspunde „continua” FĂRĂ token
// de încercare (migrarea din runda 1), NU se descarcă — opusul monitorului de egress (fail-open), pentru că garda e
// condiția de reluare a citirii automate.
// deno-lint-ignore no-explicit-any
type Supa = any
import { deschideIncercare, type Decizie, type Incercare, type MetaObiect, type RaportIncercare } from './gardaIngestLogica.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

// 'continua' vine DOAR cu un token de încercare (lease acordat atomic de ofertare_ingest_garda_incearca).
export async function gardaIncearca(supa: Supa, docId: number, meta: MetaObiect | null, sursa: string): Promise<Decizie> {
  try {
    const { data, error } = await supa.rpc('ofertare_ingest_garda_incearca', { p_doc_id: docId, p_size: meta?.size ?? null, p_etag: meta?.etag ?? null, p_sursa: sursa })
    if (error || !data?.actiune) return { actiune: 'blocat', motiv: 'garda indisponibilă: ' + (error?.message ?? 'răspuns gol') + ' — nu descarc' }
    if (data.actiune === 'continua' && !(typeof data.token === 'string' && UUID.test(data.token))) {
      return { actiune: 'blocat', motiv: 'garda a răspuns „continua” fără token de încercare (migrare veche?) — nu descarc' }
    }
    return data
  } catch (e) { return { actiune: 'blocat', motiv: 'garda indisponibilă: ' + String((e as Error)?.message ?? e) + ' — nu descarc' } }
}

// Închide încercarea `token`. Un rezultat cu token vechi/străin e ignorat de SQL (acceptat:false) și raportat aici în jurnal.
export async function gardaRezultat(supa: Supa, docId: number, token: string, r: RaportIncercare): Promise<{ acceptat?: boolean; blocat?: boolean; motiv?: string; pana_la?: string } | null> {
  try {
    const { data, error } = await supa.rpc('ofertare_ingest_garda_rezultat', {
      p_doc_id: docId, p_token: token, p_rezultat: r.rezultat, p_hash: r.hash ?? null,
      p_size: r.size ?? null, p_etag: r.etag ?? null, p_eroare: r.eroare ?? null, p_doc: r.doc ?? null,
    })
    if (error) { console.warn(`garda rezultat doc ${docId}:`, error.message); return null }
    if (data?.acceptat === false) console.warn(`garda rezultat doc ${docId} IGNORAT (${r.rezultat}):`, data.motiv)
    return data
  } catch (e) { console.warn(`garda rezultat doc ${docId}:`, (e as Error)?.message ?? e); return null }
}

// Încercarea acordată de gardă, legată de documentul ei: inchide() trimite _rezultat o singură dată.
export const incercareGarda = (supa: Supa, docId: number, token: string): Incercare =>
  deschideIncercare(token, (tok, r) => gardaRezultat(supa, docId, tok, r))
