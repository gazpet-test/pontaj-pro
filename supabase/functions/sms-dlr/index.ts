// sms-dlr — entrypoint. Poarta (POST + secret în URL comparat în timp constant + connection_id) și logica sunt în logica.ts.
// v2 (20261130d): + filtrul de IP (cf-connecting-ip față de IP_SMSLINK): observare implicit, blocare 403 cu secretul SMS_DLR_IP_STRICT=1.
// Publicare: verify_jwt=false (în NO_JWT din .github/workflows/deploy-edge-function.yml): furnizorul de SMS nu are JWT.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handler } from './logica.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

Deno.serve((req: Request) => handler(req, { sb, env: (k: string) => Deno.env.get(k) }))
