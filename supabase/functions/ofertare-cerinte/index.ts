// ofertare-cerinte — edge function: invelis HTTP + autorizare peste core.ts (extrageCerinte).
// v10 (22.09.2026): logica mutata in core.ts, ca sa ruleze IDENTIC si in workerul de pe NAS (worker/ofertare),
// unde nu exista limita de 150 s a gateway-ului (incidentul Jilava: sectiunea IV, 176 s, raspuns taiat).
// Istoric versiuni + reguli: vezi antetul din core.ts.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { extrageCerinte } from './core.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// #51 (14.09.2026): poarta pe cheltuială și pe SERVER, nu doar în UI. Cu verify_jwt=true cheia anon trece
// ca Bearer, deci oricine cu cheia publică putea porni un apel plătit. Reguli:
//  - service_role: liber (rutine interne);
//  - JWT de utilizator: doar owner sau responsabilul licitației;
//  - cheia anon (workerii server din ofertare_*_tick trimit anon JWT din Vault): doar cât coada licitației e activă.
async function autorizat(req: Request, supabase: any, licId: number, coadaTabel: string | null): Promise<string | null> {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return 'lipsește Authorization'
  // rolul se ia din payload-ul JWT: env-ul funcției poate avea alt format de cheie decât JWT-ul
  // legacy pe care îl trimit workerii din Vault (verificat 14.09: comparația de string pica).
  const rol = (() => { try { return JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role } catch (_) { return null } })()
  if (jwt === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || rol === 'service_role') return null
  if (jwt === Deno.env.get('SUPABASE_ANON_KEY') || rol === 'anon') {
    if (!coadaTabel) return 'apel neautorizat (cheie anon)'
    const { data: c } = await supabase.from(coadaTabel).select('activ').eq('licitatie_id', licId).maybeSingle()
    return c?.activ ? null : 'apel neautorizat (cheie anon, coada nu e activă)'
  }
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
  const { data: u } = await anon.auth.getUser()
  const uid = u?.user?.id
  if (!uid) return 'sesiune invalidă'
  const [{ data: prof }, { data: lic }] = await Promise.all([
    supabase.from('profiles').select('is_owner').eq('id', uid).maybeSingle(),
    supabase.from('ofertare_licitatii').select('responsabil_id').eq('id', licId).maybeSingle(),
  ])
  if (prof?.is_owner || (lic?.responsabil_id && lic.responsabil_id === uid)) return null
  return 'Citirea integrală o pornește doar ownerul sau responsabilul licitației (costă).'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  let body: any
  try { body = await req.json() } catch (_) { return fail('body JSON invalid') }
  { const na = await autorizat(req, supabase, Number(body?.licitatie_id), 'ofertare_extragere_coada'); if (na) return fail(na) }
  const r = await extrageCerinte(supabase, body)
  return new Response(JSON.stringify(r), { headers: CORS })
})
