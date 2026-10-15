// Entrypoint: doar pornește serverul. Logica + fișa de securitate: handler.ts. Deploy cu verify_jwt=true.
import { depsReale, handler } from './handler.ts'
Deno.serve((req: Request) => handler(req, depsReale()))
