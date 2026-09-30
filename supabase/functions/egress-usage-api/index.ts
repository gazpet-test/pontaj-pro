// egress-usage-api — citește usage-ul oficial din Supabase Management API (varianta B, opțională).
// ⚠️ DE ACTIVAT DOAR CU ACORDUL LUI RĂZVAN: NU e deployată. Cere secretul nou SUPABASE_MGMT_TOKEN
//    (Personal Access Token Supabase, read-only pe cât se poate) — se setează din Dashboard → Edge Functions → Secrets.
// Poartă de rol ÎN COD (nu doar verify_jwt — cheia anon e și ea un JWT valid, vezi PR #318): doar profiles.is_owner.
// Nu scrie nimic în BD, nu trimite mailuri; doar întoarce JSON-ul către widget.
// Endpoint-ul de usage (MGMT_USAGE_PATH) NU e verificat pe contul nostru — se confirmă la activare.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Content-Type': 'application/json' }
const REF = 'dxczwkbciseqniprspcu'
const MGMT_USAGE_PATH = Deno.env.get('MGMT_USAGE_PATH') ?? `/v1/projects/${REF}/analytics/endpoints/usage.api-counts?interval=7day`
const raspuns = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: CORS })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return raspuns({ error: 'neautentificat' }, 401)
  const url = Deno.env.get('SUPABASE_URL')!
  // 1) cine e utilizatorul (anon key + JWT-ul lui) — cheia anon singură nu are user → respinsă
  const { data: u, error: eU } = await createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } }).auth.getUser(jwt)
  if (eU || !u?.user?.id) return raspuns({ error: 'neautentificat' }, 401)
  // 2) poarta de rol: doar owner
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: p } = await admin.from('profiles').select('is_owner').eq('id', u.user.id).maybeSingle()
  if (p?.is_owner !== true) return raspuns({ error: 'doar owner' }, 403)
  // 3) Management API
  const token = Deno.env.get('SUPABASE_MGMT_TOKEN')
  if (!token) return raspuns({ error: 'SUPABASE_MGMT_TOKEN nesetat — funcția nu e activată' }, 200)
  try {
    const r = await fetch('https://api.supabase.com' + MGMT_USAGE_PATH, { headers: { Authorization: `Bearer ${token}` } })
    const body = await r.text()
    if (!r.ok) return raspuns({ error: `Management API ${r.status}`, detalii: body.slice(0, 500) }, 200)
    return raspuns({ ok: true, sursa: MGMT_USAGE_PATH, date: JSON.parse(body) })
  } catch (e) {
    return raspuns({ error: 'Management API: ' + ((e as Error)?.message ?? e) }, 200)
  }
})
