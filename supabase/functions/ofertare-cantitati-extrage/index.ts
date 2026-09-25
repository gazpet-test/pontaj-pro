// Entrypoint: doar pornește serverul. Toată logica e în handler.ts (importabil din teste fără Deno.serve).
import { handler, depsReale } from './handler.ts'
Deno.serve((req: Request) => handler(req, depsReale()))
