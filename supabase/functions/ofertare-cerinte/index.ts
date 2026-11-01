// ofertare-cerinte — edge function: invelis HTTP + autorizare peste core.ts (extrageCerinte).
// v10 (22.09.2026): logica mutata in core.ts, ca sa ruleze IDENTIC si in workerul de pe NAS (worker/ofertare),
// unde nu exista limita de 150 s a gateway-ului (incidentul Jilava: sectiunea IV, 176 s, raspuns taiat).
// Istoric versiuni + reguli: vezi antetul din core.ts.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { extrageCerinte } from './core.ts'
import { poateCheltui } from '../_shared/poartaCheltuiala.ts'   // poarta unică pe cheltuială (20261124a)
import { esteApelIntern } from '../_shared/poartaIntern.ts'
import { autorizeazaCerinte } from './autorizare.ts'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-intern-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// Poarta (20261124a, 3A): calea anon „cât coada e activă” a dispărut — tick-ul pg_cron se autentifică cu x-intern-secret, omul cu JWT;
// ambii trec prin poarta unică pe cheltuială. Logica + testele: autorizare.ts / autorizare_test.ts.
async function autorizat(req: Request, supabase: any, licId: number): Promise<string | null> {
  return await autorizeazaCerinte(req.headers.get('authorization'), licId, {
    esteIntern: () => esteApelIntern(req, supabase),
    coada: async (id) => {
      const { data, error } = await supabase.from('ofertare_extragere_coada').select('activ, cerut_de').eq('licitatie_id', id).maybeSingle()
      return error ? null : data
    },
    getUser: async (jwt) => {
      const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
      const { data: u } = await anon.auth.getUser()
      return u?.user?.id ?? null
    },
    poateCheltui: (id, uid) => poateCheltui(supabase, id, uid),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = (msg: string) => new Response(JSON.stringify({ error: msg }), { status: 200, headers: CORS })
  let body: any
  try { body = await req.json() } catch (_) { return fail('body JSON invalid') }
  { const na = await autorizat(req, supabase, Number(body?.licitatie_id)); if (na) return fail(na) }
  const r = await extrageCerinte(supabase, body)
  return new Response(JSON.stringify(r), { headers: CORS })
})
