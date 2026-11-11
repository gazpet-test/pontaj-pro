// polita-citeste — „📖 Citește documentul” la încărcarea unei polițe / unui act adițional (Polițe 20261205a, etapa 1).
// Logica și poarta: handler.ts. Deploy (chat, după „da”): verify_jwt poate rămâne pornit (UI-ul trimite JWT-ul utilizatorului);
// poarta reală e în cod (fn_poate_scrie_polite prin clientul utilizatorului + poarta pe cheltuială).
// Secrete folosite (doar nume, existente): ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { citestePolita } from './handler.ts'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const auth = req.headers.get('Authorization') || ''
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const ledger = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let body: unknown = null
  try { body = await req.json() } catch (_) { body = null }
  return citestePolita(req, body, caller, ledger, Deno.env.get('ANTHROPIC_API_KEY'), CORS)
})
