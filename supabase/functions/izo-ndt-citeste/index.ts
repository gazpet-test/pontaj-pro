// izo-ndt-citeste v2 (28.11.2026, citirile pe server — migrarea 20270115b) — citirea unui buletin NDT cu AI, pentru confirmarea MP-ului.
// Intrare: POST { buletin_id, cerere: UUID (cheia intenției, refolosită la reluare), model?: 'principal' | 'alternativ' } cu JWT-ul
// utilizatorului. Logica și fișa de securitate: handler.ts. Cere migrarea 20270115b aplicată (fn_sud_citire_rezerva / _salveaza).
// Nu confirmă și nu scrie rânduri: salvează citirea validată în sud_citiri și o întoarce; confirmarea o face MP-ul prin fn_sud_buletin_confirma.
// Secrete (doar numele): ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (ultimul DOAR pentru ai_plafon_*).
// Opționale: IZO_NDT_MODEL_PRINCIPAL / IZO_NDT_MODEL_ALTERNATIV (doar din lista permisă din handler.ts).
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { citesteBuletinNdt, modeleNdt } from './handler.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
// Modelele se rezolvă o dată, la pornire, din lista permisă.
const MODELE = modeleNdt(Deno.env.get('IZO_NDT_MODEL_PRINCIPAL'), Deno.env.get('IZO_NDT_MODEL_ALTERNATIV'))

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const optiuni = { auth: { persistSession: false, autoRefreshToken: false } }
  // Clientul apelantului: citirea buletinului (RLS), fn_sud_drept și descărcarea din Storage se fac cu JWT-ul lui.
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { ...optiuni, global: { headers: { Authorization: req.headers.get('Authorization') || '' } } })
  // service_role EXCLUSIV pentru registrul de cost (fn_ai_plafon_rezerva / _deconteaza au EXECUTE doar pentru service_role).
  const ledger = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, optiuni)
  return await citesteBuletinNdt(req, caller, ledger, { apiKey: Deno.env.get('ANTHROPIC_API_KEY'), modele: MODELE }, CORS)
})
