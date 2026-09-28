// Identitatea și accesul se verifică pe clientul utilizatorului, înainte de service_role.
// null = permis; context.userId primește identitatea verificată (pentru created_by).
type ClientPoarta = {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null } | null; error?: unknown }> }
  rpc: (name: string) => PromiseLike<{ data: unknown; error?: unknown }>
}
export type DepsPoartaOfertare = {
  createClient?: (url: string, key: string, options: {
    global: { headers: { Authorization: string } }
    auth: { persistSession: boolean; autoRefreshToken: boolean }
  }) => ClientPoarta
  env?: (name: string) => string | undefined
  context?: { userId?: string }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const refuz = (status: number) => new Response(JSON.stringify({
  error: status === 401 ? 'unauthorized' : 'nu ai acces la modulul Ofertare',
}), { status, headers: CORS })

export async function poartaOfertare(req: Request, deps: DepsPoartaOfertare = {}): Promise<Response | null> {
  if (deps.context) delete deps.context.userId
  const jwt = /^Bearer\s+(\S+)$/i.exec(req.headers.get('Authorization') || '')?.[1]
  if (!jwt) return refuz(401)

  let client: ClientPoarta
  let userId: string
  try {
    const env = deps.env ?? ((name: string) => Deno.env.get(name))
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY')
    if (!url || !anon) return refuz(401)
    const createClient = deps.createClient ?? (await import('npm:@supabase/supabase-js@2')).createClient
    client = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data, error } = await client.auth.getUser()
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
