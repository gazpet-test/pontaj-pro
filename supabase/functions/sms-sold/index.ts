// sms-sold — entrypoint. Poarta (cronul intern sau owner-ul, verificate în cod) și logica sunt în logica.ts.
// Publicare: verify_jwt=false (în NO_JWT din .github/workflows/deploy-edge-function.yml): cronul pg_cron nu are JWT; poarta din cod
// cere x-intern-secret (Vault INTERN_EDGE_SECRET) SAU un JWT de owner (auth.getUser + fn_sms_nivel() = 'owner', cu JWT-ul lui).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handler } from './logica.ts'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const sb = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const sbUtilizator = (jwt: string) =>
  createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })

Deno.serve((req: Request) => handler(req, { sb, sbUtilizator, env: (k: string) => Deno.env.get(k), fetch }))
