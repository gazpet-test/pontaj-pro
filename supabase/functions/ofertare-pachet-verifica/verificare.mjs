import { createHash } from 'node:crypto'

// Paritate verificată cu fn_pt_fisier_cere_verificare din migrare.
export const ROLURI_DOVEDIT = ['propunere_docx', 'borderou_docx', 'depus_final', 'dovada_seap']
export const MAX_BYTES = 32 * 1024 * 1024
const SHA_GOL = createHash('sha256').digest('hex')
const UUID_LIPSA = '00000000-0000-0000-0000-000000000000'
const PREA_MARE = 'prea mare, worker Terra'

export function dimensiune(o) {
  const size = o?.metadata?.size
  if (!/^[0-9]+$/.test(String(size ?? ''))) return null
  const n = Number(size)
  return Number.isSafeInteger(n) ? n : null
}
export function snapshotIdentic(a, b) {
  return !!a && !!b && a.id === b.id && a.updated_at === b.updated_at
    && a.bucket_id === b.bucket_id && a.name === b.name
    && (a.metadata?.eTag ?? null) === (b.metadata?.eTag ?? null)
    && dimensiune(a) === dimensiune(b)
}
export function caleValida(path) {
  return typeof path === 'string' && path.trim() !== '' && !path.includes('\\')
    && !/[\x00-\x1f\x7f]/.test(path)
    && path.split('/').every(p => p && p !== '.' && p !== '..')
}

// Fără Blob/arrayBuffer: memoria crește doar cu chunk-ul curent, nu cu fișierul.
export async function hashStream(body, maxBytes = MAX_BYTES) {
  if (!body) return { motiv: 'descărcare fără conținut', sha256: SHA_GOL, size: 0 }
  const reader = body.getReader(), hash = createHash('sha256')
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        try { await reader.cancel() } catch { /* Limita rămâne motivul refuzului. */ }
        return { motiv: PREA_MARE, sha256: SHA_GOL, size }
      }
      hash.update(value)
    }
    return { sha256: hash.digest('hex'), size, motiv: size ? null : 'obiect gol' }
  } finally { reader.releaseLock() }
}

// Dependențe injectate pentru probele pre/post, streaming și persistența refuzurilor.
// Obiect absent/hash necalculat: sentinel explicit, NUMAI REFUZ; niciodată dovadă PASS.
export async function verificaFisier(f, userId, { snapshot, download, maxBytes = MAX_BYTES }) {
  const row = {
    pachet_fisier_id: f.id, bucket: 'ofertare', fisier_path: f.fisier_path ?? '',
    obj_id: UUID_LIPSA, obj_updated_at: '1970-01-01T00:00:00.000Z', obj_etag: null,
    obj_size: 0, sha256_calculat: SHA_GOL, sha256_declarat: f.sha256,
    rezultat: 'REFUZ', motiv: null, verificat_de: userId,
  }
  const refuz = motiv => ({ ...row, motiv })
  if (!caleValida(f.fisier_path)) return refuz('fisier_path lipsă sau invalid')
  try {
    const before = await snapshot(f.id)
    if (!before) return refuz('obiect inexistent în bucket-ul ofertare')
    if (before.bucket_id !== 'ofertare' || before.name !== f.fisier_path || !before.id || !before.updated_at) {
      return refuz('snapshot invalid sau manifest schimbat')
    }
    Object.assign(row, { obj_id: before.id, obj_updated_at: before.updated_at,
      obj_etag: before.metadata?.eTag ?? null, obj_size: dimensiune(before) ?? 0 })
    if (dimensiune(before) === null) return refuz('dimensiune necunoscută sau invalidă')
    if (!row.obj_size) return refuz('obiect gol')
    if (row.obj_size > maxBytes) return refuz(PREA_MARE)
    const response = await download(f.fisier_path)
    if (!response.ok) {
      await response.body?.cancel()
      return refuz(`descărcare eșuată (HTTP ${response.status})`)
    }
    const hash = await hashStream(response.body, maxBytes)
    if (!hash.motiv) row.sha256_calculat = hash.sha256
    const after = await snapshot(f.id)
    if (!snapshotIdentic(before, after)) return refuz('obiect schimbat în timpul verificării')
    if (hash.motiv) return refuz(hash.motiv)
    if (hash.size !== row.obj_size) return refuz('dimensiunea descărcată diferă de snapshot')
    if (hash.sha256 !== f.sha256) return refuz('SHA-256 diferit de manifest')
    return { ...row, rezultat: 'PASS', motiv: null }
  } catch {
    return refuz('citire Storage/snapshot indisponibilă sau întreruptă; reîncearcă verificarea')
  }
}
