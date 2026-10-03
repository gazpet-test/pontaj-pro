// Poarta pentru funcțiile edge pornite DOAR din BD (trigger / pg_cron prin pg_net) — task #17, 03.10.2026.
// Apelantul trimite antetul x-intern-secret = Vault INTERN_EDGE_SECRET (64 hex, creat de migrarea 20261011a).
// Verificarea se face în BD prin fn_verifica_secret (acceptă și INTERN_EDGE_SECRET_VECHI pe durata unei rotiri),
// deci valoarea nu stă nici în sursă, nici în Edge Secrets. Orice abatere sau eroare → false (fail closed).
// Folosită de: cleanup-recycle-bin (cron), detect-ordine (trg_detect_ordine), citeste-orice (trg_ai_inbox_clasificare).
export const ANTET_INTERN = 'x-intern-secret'
const FORMAT_SECRET = /^[0-9a-f]{64}$/

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

export async function esteApelIntern(req: Request, supabase: RpcClient): Promise<boolean> {
  const antet = req.headers.get(ANTET_INTERN) || ''
  if (!FORMAT_SECRET.test(antet)) return false
  try {
    const { data, error } = await supabase.rpc('fn_verifica_secret', { p_nume: 'INTERN_EDGE_SECRET', p_secret: antet })
    return !error && data === true
  } catch (_) {
    return false
  }
}
