// ═══════════════════════════════════════════════════════════════════════════
// storageRls.js — instrumentare monitorizare erori RLS la upload în Storage.
// Orice .upload()/.update() din browser care pică pe „row-level security"
// raportează bucket + cale + user prin RPC log_storage_upload_error
// (SECURITY DEFINER, grant doar authenticated) → tabelul storage_rls_errors.
// Se aplică O DATĂ pe client (la createClient) — call site-urile NU se ating,
// iar componentele noi sunt acoperite automat.
// Logarea e fire-and-forget: dacă RPC-ul eșuează (offline, neautentificat),
// eroarea reală de upload ajunge neatinsă la apelant.
// ═══════════════════════════════════════════════════════════════════════════

const RLS_RE = /row-level security|violates row-level/i

export function instrumenteazaStorageRls(client) {
  const fromOrig = client.storage.from.bind(client.storage)
  client.storage.from = (bucket) => {
    const api = fromOrig(bucket)
    for (const metoda of ['upload', 'update']) {
      if (typeof api[metoda] !== 'function') continue
      const orig = api[metoda].bind(api)
      api[metoda] = async (path, ...rest) => {
        const res = await orig(path, ...rest)
        if (res?.error && RLS_RE.test(res.error.message || '')) {
          try {
            void client.rpc('log_storage_upload_error', {
              p_bucket: bucket, p_path: String(path), p_message: res.error.message,
            }).then(() => {}, () => {})
          } catch (_) { /* înghițit deliberat — logarea nu maschează eroarea reală */ }
        }
        return res
      }
    }
    return api
  }
  return client
}
