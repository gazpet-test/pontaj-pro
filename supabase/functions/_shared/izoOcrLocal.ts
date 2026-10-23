// Secret separat, fără alias sau fallback la secretul OCR de ofertare.
export const ANTET_IZO_OCR = 'x-izo-ocr-local-secret'
export const SECRET_IZO_OCR = 'IZO_OCR_LOCAL_SECRET'
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> }
export async function esteApelIzoOcrLocal(req: Request, client: Rpc): Promise<boolean> {
  const secret = req.headers.get(ANTET_IZO_OCR) || ''
  if (!/^[0-9a-f]{64}$/.test(secret)) return false
  try {
    const { data, error } = await client.rpc('fn_verifica_secret', { p_nume: SECRET_IZO_OCR, p_secret: secret })
    return !error && data === true
  } catch { return false }
}
