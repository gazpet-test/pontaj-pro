import { poartaOfertare } from '../_shared/poartaOfertare.ts'
import { evalueazaTexte, PARSER_VERSION } from './evalueaza.mjs'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}
const raspuns = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers })
type Deps = {
  gate?: typeof poartaOfertare
  client: () => Promise<any>
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return raspuns(405, { error: 'method_not_allowed' })
  const refuz = await (deps.gate ?? poartaOfertare)(req)
  if (refuz) return refuz
  let body
  try { body = await req.json() } catch { return raspuns(400, { error: 'JSON invalid' }) }
  const id = body?.licitatie_id
  if (!Number.isSafeInteger(id) || id <= 0) return raspuns(400, { error: 'licitatie_id invalid' })
  try {
    // Cheia service_role este încărcată numai DUPĂ verificarea identității și accesului.
    const client = await deps.client()
    const { data: sursa, error } = await client.rpc('ofertare_poarta_text_sursa', { p_licitatie_id: id })
    if (error || !sursa || !/^[0-9a-f]{64}$/.test(sursa.sursa_hash)) return raspuns(409, { error: 'Sursa indisponibilă; poarta rămâne blocată' })
    if (sursa.parser_version !== PARSER_VERSION) return raspuns(409, { error: 'Versiunea parserului diferă de server; poarta rămâne blocată' })
    const rezultate = evalueazaTexte(sursa.date).map(r => ({ ...r, licitatie_id: id,
      parser_version: PARSER_VERSION, sursa_hash: sursa.sursa_hash }))
    const { error: scriere } = await client.from('ofertare_poarta_rezultate_text').insert(rezultate)
    if (scriere) return raspuns(500, { error: 'Rezultatele nu au putut fi persistate' })
    // Erorile de parser sunt persistate ca undetermined; nu aruncăm erori de business.
    return raspuns(200, { rezultate })
  } catch {
    return raspuns(500, { error: 'Evaluarea nu a putut fi finalizată; poarta rămâne blocată' })
  }
}
