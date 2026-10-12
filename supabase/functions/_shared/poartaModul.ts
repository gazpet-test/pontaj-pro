// Poarta de modul pentru edge functions pornite din UI cu JWT-ul utilizatorului (10.10.2026, poke chat).
// verify_jwt NU e suficient: cheia anon e și ea un JWT valid (lecția din PR #318). Aici:
//   - fără utilizator real (anon, token invalid/expirat) → 401;
//   - owner → trece;
//   - altfel e nevoie de o intrare EXPLICITĂ în user_module_access pe unul din modulele cerute
//     (regula de acces dual din CLAUDE.md: rolul singur nu ajunge).
// Orice eroare de citire → refuz (fail closed).
export type Decizie = { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }

export function decideModul(p: { userId: string | null; isOwner: boolean; moduleAvute: string[] }, cerute: string[]): Decizie {
  if (!p.userId) return { ok: false, status: 401, error: 'Neautorizat' }
  if (p.isOwner) return { ok: true, userId: p.userId }
  if (p.moduleAvute.some(m => cerute.includes(m))) return { ok: true, userId: p.userId }
  return { ok: false, status: 403, error: 'Fără acces la modul' }
}

// db = clientul cu service_role (folosit aici doar la citiri: auth.getUser, profiles.is_owner, user_module_access).
// deno-lint-ignore no-explicit-any
export async function poartaModul(req: Request, db: any, cerute: string[]): Promise<Decizie> {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return decideModul({ userId: null, isOwner: false, moduleAvute: [] }, cerute)
  try {
    const { data, error } = await db.auth.getUser(jwt)
    const userId = !error && data?.user?.id ? data.user.id : null
    if (!userId) return decideModul({ userId: null, isOwner: false, moduleAvute: [] }, cerute)
    const [prof, acc] = await Promise.all([
      db.from('profiles').select('is_owner').eq('id', userId).maybeSingle(),
      db.from('user_module_access').select('module').eq('profile_id', userId).in('module', cerute),
    ])
    if (prof.error || acc.error) return { ok: false, status: 403, error: 'Accesul nu a putut fi verificat' }
    return decideModul({ userId, isOwner: prof.data?.is_owner === true, moduleAvute: (acc.data || []).map((r: { module: string }) => r.module) }, cerute)
  } catch (_) {
    return { ok: false, status: 403, error: 'Accesul nu a putut fi verificat' }
  }
}
