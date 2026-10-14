// Entrypoint detect_plate_orphan_msgs: doar pornește serverul. Logica e în handler.ts (importabil din teste fără Deno.serve),
// poarta în acces.ts. Nu adăuga aici nicio cale de acces: tot ce intră trece prin handler → poartaPlate.
// depsReale se dă ca FABRICĂ (nechemată): handler-ul o cheamă după OPTIONS, în try. Forma fișierului e verificată strict în CI
// (verifica-edge-functions.yml, pasul „detect_plate_orphan_msgs fără ocolire”) — orice altă linie de cod pică garda.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { handler, depsReale } from './handler.ts'

Deno.serve((req: Request) => handler(req, depsReale))
