// sms-trimite — entrypoint. Logica și poarta (owner sau cron intern, verificate în cod) sunt în logica.ts.
// Publicare: verify_jwt=true (UI-ul trimite JWT-ul owner-ului). Un cron viitor cu x-intern-secret fără JWT cere trecerea în NO_JWT
// din .github/workflows/deploy-edge-function.yml (poarta din cod rămâne aceeași).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handler } from './logica.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

Deno.serve((req: Request) => handler(req, { sb, env: (k: string) => Deno.env.get(k), fetch, acum: Date.now }))
