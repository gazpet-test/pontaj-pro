import { createClient } from 'npm:@supabase/supabase-js@2.39.0'
import { createHandler } from './handler.ts'

Deno.serve(createHandler({ createClient, env: name => Deno.env.get(name), fetcher: fetch }))
