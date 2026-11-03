// sms-trimite — entrypoint. Logica și poarta (cron intern sau cont cu nivel SMS, verificate în cod) sunt în logica.ts.
// Publicare: verify_jwt=true (UI-ul trimite JWT-ul contului). Un cron viitor cu x-intern-secret fără JWT cere trecerea în NO_JWT
// din .github/workflows/deploy-edge-function.yml (poarta din cod rămâne aceeași).
// Doi clienți: service_role (poarta + fn_sms_rezerva / fn_sms_rezultat) și, per cerere, unul cu cheia anon + JWT-ul contului, folosit
// DOAR pentru fn_sms_nivel() (nivelul îl spune BD-ul pentru acel token).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { handler } from './logica.ts'

const URL_SB = Deno.env.get('SUPABASE_URL')!
const sb = createClient(URL_SB, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const sbUtilizator = (jwt: string) =>
  createClient(URL_SB, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })

Deno.serve((req: Request) => handler(req, { sb, sbUtilizator, env: (k: string) => Deno.env.get(k), fetch, acum: Date.now }))
