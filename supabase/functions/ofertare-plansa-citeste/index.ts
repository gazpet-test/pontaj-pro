// Entrypoint: doar pornește serverul. Toată logica e în handler.ts (importabil din teste fără Deno.serve).
// #908 r4 (review r3 Jakarinos P1-01 / Copilot P1-03): prin HTTP cheia de serviciu NU mai e cale de cheltuială — handler-ul primește
// SERVICE = '' (nicio cheie nu e „valabilă”), deci orice apel trece prin JWT de utilizator + poarta pe cheltuială. Singurul apelant cu
// cheia de serviciu e workerul NAS, care cheamă handler-ul ÎN PROCES (worker/ofertare/plansa.ts) și întreabă el poarta pe cerut_de-ul
// jobului înaintea fiecărui apel.
import { handler, depsReale } from './handler.ts'
Deno.serve((req: Request) => handler(req, { ...depsReale(), SERVICE: '' }))
