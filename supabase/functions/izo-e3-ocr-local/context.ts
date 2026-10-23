import { type SablonE3 } from '../ocr-packing-list/avizE3.ts'
import { rpc, type Client } from './rpc.ts'

export type ContextCerere = {
  id: string; creat_de: string; proiect_id: number; depozit_id: number; sablon: SablonE3;
  drept_platit_de: 'arbitraj' | 'fallback' | null; apel_faza: string | null;
  apel_raspuns: Record<string, unknown> | null; rezervare_id: number | null; cost_usd: number | null;
}
export type CitesteContext = (id: string, user: string | null, token: string | null) => Promise<ContextCerere | null>
// Excepția unică înainte de poartă: după getUser, citim numai contextul
// creatorului. Drepturile se verifică ulterior exclusiv cu clientul caller.
// Workerul folosește celălalt selector, tokenul curent, niciodată user din body.
export function citesteContext(client: Client): CitesteContext {
  return async (id, user, token) => {
    const rows = await rpc(client, 'context', { p_id: id, p_user: user, p_token: token })
    return (Array.isArray(rows) ? rows[0] ?? null : null) as ContextCerere | null
  }
}
