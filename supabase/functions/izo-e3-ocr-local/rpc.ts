import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { EroareE3 } from '../ocr-packing-list/avizE3.ts'
export type Client = SupabaseClient
const CODURI: Record<string, number> = { nu_exista: 404, nu_e_creatorul: 404, token_invalid: 409, termen_depasit: 409, stare_invalida: 409, faza_invalida: 409, ramura_inchisa: 409, parametri_invalizi: 400 }
export async function rpc(client: Client, nume: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await client.rpc(`fn_ocr_local_${nume}`, args)
  if (error) throw new EroareE3(Object.hasOwn(CODURI, error.message) ? error.message : 'coada_indisponibila', CODURI[error.message] || 503)
  return data
}
export function primul<T>(v: unknown): T {
  const r = Array.isArray(v) ? v[0] : v
  if (!r || typeof r !== 'object') throw new EroareE3('coada_indisponibila', 503)
  return r as T
}
export type Stare = { stare: string; ramura: string | null; rezultat: Record<string, unknown> | null; eroare: string | null; termen_local: string | null; termen_fallback: string | null }
export async function stare(client: Client, id: string, user: string) {
  const r = primul<Stare>(await rpc(client, 'stare', { p_id: id, p_user: user }))
  // Proiecție închisă, chiar dacă RPC-ul va primi ulterior coloane interne.
  return { stare: r.stare, ramura: r.ramura, rezultat: r.stare === 'gata' ? r.rezultat : null, eroare: r.eroare, termen_local: r.termen_local, termen_fallback: r.termen_fallback }
}
export type Drept = { acordat: boolean; stare: string; drept_platit_de: 'arbitraj' | 'fallback'; apel_faza: string; proiect: number; user: string; sablon: 'aviz_teava' | 'lista_curbe'; cale: string }
