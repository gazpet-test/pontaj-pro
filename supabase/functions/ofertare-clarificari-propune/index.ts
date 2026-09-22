// ofertare-clarificari-propune v1 (22.09.2026) — înveliș HTTP: auth (owner/responsabil/service_role) + Response.
// Logica e în core.ts (propuneClarificari), rulată identic și de workerul NAS (worker/ofertare/clarificari.ts).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { propuneClarificari } from './core.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// aceeași poartă ca la acoperire: apel plătit → doar owner / responsabilul licitației / service_role
async function autorizat(req: Request, supabase: any, licId: number): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'lipsește autorizarea'
  let rol = ''
  try { rol = JSON.parse(atob(jwt.split('.')[1] || '')).role || '' } catch (_) { /* nu e JWT */ }
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || rol === 'service_role') return null
  if (rol === 'anon') return 'apel neautorizat (cheie anon)'
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: u } = await anon.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'sesiune invalidă'
  const [{ data: prof }, { data: lic }] = await Promise.all([
    supabase.from('profiles').select('is_owner').eq('id', uid).maybeSingle(),
    supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', licId).maybeSingle(),
  ])
  if (prof?.is_owner || (lic?.responsabil_id && lic.responsabil_id === uid)) return null
  return 'Propunerea de clarificări o pornește doar ownerul sau responsabilul licitației (costă).'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  let body: any
  try { body = await req.json() } catch (_) { return fail('body JSON invalid') }
  const licId = Number(body?.licitatie_id)
  if (!licId) return fail('licitatie_id obligatoriu')
  { const na = await autorizat(req, supabase, licId); if (na) return fail(na) }
  const r = await propuneClarificari(supabase, body)
  return new Response(JSON.stringify(r), { status: 200, headers: CORS })
})
