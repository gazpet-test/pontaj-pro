// Monitor egress (docs/MONITOR_EGRESS.md, migrarea 20260930e_monitor_egress.sql) — copia pentru EDGE (05.10.2026).
// Identică cu worker/ofertare/egress.ts (workerul NAS rulează separat și are copia lui). Poartă + jurnal pentru
// descărcările din Storage, fail-OPEN pe erorile RPC: monitorul nu are voie să oprească producția,
// DOAR un marcaj explicit de blocare (pus de detector, scos de owner) refuză descărcarea.
// deno-lint-ignore no-explicit-any
type Supa = any

export const MESAJ_BLOCAT = 'descărcare blocată de monitorul de egress (prea multe descărcări ale aceluiași fișier) — deblocare din ERP, doar owner'

export async function egressBlocat(supa: Supa, bucket: string, obiect: string): Promise<boolean> {
  try {
    const { data, error } = await supa.rpc('egress_obiect_blocat', { p_bucket: bucket, p_obiect: obiect })
    if (error) { console.warn('egress poarta:', error.message); return false }
    return data === true
  } catch (e) { console.warn('egress poarta:', (e as Error)?.message ?? e); return false }
}

export async function egressLog(supa: Supa, bucket: string, obiect: string, bytes: number, sursa: string, docId?: number | null): Promise<void> {
  try {
    const { error } = await supa.rpc('egress_log_descarcare', { p_bucket: bucket, p_obiect: obiect, p_bytes: Math.max(0, Math.round(Number(bytes) || 0)), p_sursa: sursa, p_doc_id: docId ?? null })
    if (error) console.warn('egress log:', error.message)
  } catch (e) { console.warn('egress log:', (e as Error)?.message ?? e) }
}

// Înlocuitor pentru supa.storage.from(bucket).download(obiect): același { data, error }.
export async function descarcaCuJurnal(supa: Supa, bucket: string, obiect: string, sursa: string, docId?: number | null): Promise<{ data: Blob | null; error: { message: string } | null }> {
  if (await egressBlocat(supa, bucket, obiect)) return { data: null, error: { message: MESAJ_BLOCAT } }
  const r = await supa.storage.from(bucket).download(obiect)
  if (!r.error && r.data) await egressLog(supa, bucket, obiect, r.data.size, sursa, docId)
  return r
}
