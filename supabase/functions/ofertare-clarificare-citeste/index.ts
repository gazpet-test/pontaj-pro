// Entrypoint: doar pornește serverul. Toată logica (poarta pe rol + citirea AI a PDF-ului) e în handler.ts, importabil din teste
// fără Deno.serve și fără rețea.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handler, depsReale } from './handler.ts'

const deps = depsReale(createClient)
Deno.serve((req: Request) => handler(req, deps))
