// Rulare: docker exec gazpet-ofertare-worker deno run -A /app/worker/ofertare/verifica_manifest.ts <licitatie_id> [--uscat]
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { verificaManifest } from './verifica_manifest_lib.ts'

const licId = Number(Deno.args[0])
const uscat = Deno.args.includes('--uscat')
if (!licId) { console.error('folosire: verifica_manifest.ts <licitatie_id> [--uscat]'); Deno.exit(2) }
const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
try {
  console.log(JSON.stringify(await verificaManifest(supa, licId, { uscat }), null, 1))
} catch (e) {
  console.error((e as Error)?.message ?? e)
  Deno.exit(1)
}
