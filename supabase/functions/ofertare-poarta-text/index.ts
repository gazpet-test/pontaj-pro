import { handle } from './handler.ts'

Deno.serve(req => handle(req, {
  client: async () => {
    const { createClient } = await import('npm:@supabase/supabase-js@2')
    return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } })
  },
}))
