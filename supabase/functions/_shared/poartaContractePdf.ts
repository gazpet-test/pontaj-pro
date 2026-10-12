// Poarta și validările pentru contracte-pdf-link (12.10.2026, varianta A aleasă de Răzvan).
// Serverul AI cere un link semnat de scurtă durată către PDF-ul unui contract din contracte_terti.
// Identitatea apelantului NU e un cont Supabase (un cont logat citește tot ce are auth.uid() IS NOT NULL), ci un secret
// dedicat din Vault: CONTRACTE_PDF_LINK_SECRET (64 hex, creat de Răzvan în Vault, ținut pe serverul AI).
// Verificarea se face în BD prin fn_verifica_secret (acceptă și <nume>_VECHI pe durata unei rotiri). Orice abatere → false.
export const ANTET_CONTRACTE_PDF = 'x-contracte-secret'
export const NUME_SECRET = 'CONTRACTE_PDF_LINK_SECRET'
const FORMAT_SECRET = /^[0-9a-f]{64}$/

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }

export async function esteApelContractePdf(req: Request, supabase: RpcClient): Promise<boolean> {
  const antet = req.headers.get(ANTET_CONTRACTE_PDF) || ''
  if (!FORMAT_SECRET.test(antet)) return false
  try {
    const { data, error } = await supabase.rpc('fn_verifica_secret', { p_nume: NUME_SECRET, p_secret: antet })
    return !error && data === true
  } catch (_) {
    return false
  }
}

export type Cerere = { ok: true; contractId: number } | { ok: false; error: string }

// Corpul cererii: { "contract_id": <întreg pozitiv> }. Nimic altceva nu e citit.
export function valideazaCerere(corp: unknown): Cerere {
  if (!corp || typeof corp !== 'object' || Array.isArray(corp)) return { ok: false, error: 'Corp JSON invalid' }
  const id = (corp as Record<string, unknown>).contract_id
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, error: 'contract_id trebuie să fie un număr întreg pozitiv' }
  return { ok: true, contractId: id }
}

// Calea din contracte_terti.pdf_path e text scris de utilizatori ai platformei: o acceptăm doar dacă arată a cale relativă
// de obiect (fără .., fără început cu /, fără caractere de control sau backslash, lungime rezonabilă).
export function caleSigura(cale: unknown): string | null {
  if (typeof cale !== 'string') return null
  if (cale.length === 0 || cale.length > 500) return null
  if (cale.startsWith('/') || cale.includes('\\') || /[\u0000-\u001f]/.test(cale)) return null
  if (cale.split('/').some((p) => p === '..' || p === '.' || p === '')) return null
  return cale
}
