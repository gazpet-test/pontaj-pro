// Entrypoint extract-talon-ai: doar pornește serverul. Logica e în handler.ts (importabil din teste fără Deno.serve),
// poarta în acces.ts. Nu adăuga aici nicio cale de acces: tot ce intră trece prin handler → poartaTalon.
// depsReale se dă ca FABRICĂ (nechemată): handler-ul o cheamă după OPTIONS, în try. Forma fișierului e verificată strict în CI
// (verifica-edge-functions.yml, pasul „extract-talon-ai și rag-normative fără secret intern”) — orice altă linie de cod pică garda.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { handler, depsReale } from './handler.ts'

Deno.serve((req: Request) => handler(req, depsReale))
