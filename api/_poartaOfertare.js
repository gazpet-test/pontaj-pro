import { createClient } from '@supabase/supabase-js'

// null = permis; un refuz este trimis de handler înainte să citească body.
// Nu există bypass pentru service_role sau pentru secrete în helperul comun.
export async function poartaOfertare(req, deps = {}) {
  if (deps.context) delete deps.context.userId
  const header = req.headers?.authorization
  const jwt = typeof header === 'string' && /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (!jwt) return { status: 401, body: { error: 'unauthorized' } }
  const refuz = (status) => ({ status, body: {
    error: status === 401 ? 'unauthorized' : 'nu ai acces la modulul Ofertare',
  } })

  let client, userId
  try {
    const env = deps.env ?? process.env
    const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL
    const anon = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) return refuz(401)
    client = (deps.createClient ?? createClient)(url, anon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.getUser(jwt)
    if (error || !data?.user?.id) return refuz(401)
    userId = data.user.id
  } catch { return refuz(401) }

  try {
    const { data, error } = await client.rpc('fn_are_acces_ofertare')
    if (error || data !== true) return refuz(403)
  } catch { return refuz(403) }

  if (deps.context) deps.context.userId = userId
  return null
}
