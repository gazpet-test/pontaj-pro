// Secret only from the caller's Edge Secrets environment, never a fallback value.
export async function authorized(req: Request, secret: string | undefined,
  owner: (jwt: string) => Promise<boolean>): Promise<boolean> {
  const supplied = req.headers.get('x-noutati-secret') ?? ''
  if (secret && secret.length >= 24 && secret.trim() === secret && supplied.length <= 4096) {
    // Fixed-size digest comparison; no claim of machine-level constant time in JS.
    const enc = new TextEncoder()
    const [a, b] = await Promise.all([secret, supplied].map(async x =>
      new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(x)))))
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
    if (supplied && diff === 0) return true
  }
  const match = /^Bearer ([^\s]+)$/i.exec(req.headers.get('authorization') ?? '')
  if (!match) return false
  try { return (await owner(match[1])) === true } catch { return false }
}
