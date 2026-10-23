import { createClient } from 'npm:@supabase/supabase-js@2'
import { handle } from './handler.ts'

// La livrare: verify_jwt=false; fiecare operație are propria poartă în handler.
Deno.serve((req: Request) => {
  const url = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY'), service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return Response.json({ success: false, eroare: 'configurare_lipsa' }, { status: 503 })
  const auth = { persistSession: false, autoRefreshToken: false }
  const caller = createClient(url, anon, { auth, global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  const ledger = createClient(url, service, { auth })
  return handle(req, { caller, ledger, apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
})
