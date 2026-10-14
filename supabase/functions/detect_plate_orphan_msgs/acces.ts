// acces.ts — poarta pentru detect_plate_orphan_msgs (14.10.2026, securitate etapa 2 grup A).
// Singurul apelant e UI-ul (Logistică → Alimentări → Import WhatsApp → procesare AI a pozelor orfane), cu JWT-ul sesiunii.
// verify_jwt NU e suficient: cheia anon e și ea un JWT valid (lecția din PR #318). Aici:
//   - fără utilizator real (fără antet, cheia anon, token invalid/expirat) → 401;
//   - owner (profiles.is_owner) → trece;
//   - rol admin_logistica ȘI intrare EXPLICITĂ 'logistica' în user_module_access → trece
//     (regula de acces dual din CLAUDE.md: rolul singur nu ajunge);
//   - altfel → 403.
// Orice eroare de citire → refuz (fail closed). Nu există cale internă / antet-secret.
export type Decizie = { ok: true; userId: string } | { ok: false; status: 401 | 403; error: string }

export const ROL_CERUT = 'admin_logistica'
export const MODUL_CERUT = 'logistica'

export function decidePlate(p: { userId: string | null; isOwner: boolean; rol: string | null; areModul: boolean }): Decizie {
  if (!p.userId) return { ok: false, status: 401, error: 'Neautorizat' }
  if (p.isOwner) return { ok: true, userId: p.userId }
  if (p.rol === ROL_CERUT && p.areModul) return { ok: true, userId: p.userId }
  return { ok: false, status: 403, error: 'forbidden' }
}

const NEVERIFICAT: Decizie = { ok: false, status: 403, error: 'Accesul nu a putut fi verificat' }

// db = clientul cu service_role (folosit aici doar la citiri: auth.getUser, profiles, user_module_access).
// deno-lint-ignore no-explicit-any
export async function poartaPlate(req: Request, db: any): Promise<Decizie> {
  const fara = decidePlate({ userId: null, isOwner: false, rol: null, areModul: false })
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return fara
  try {
    const { data, error } = await db.auth.getUser(jwt)
    const userId = !error && data?.user?.id ? data.user.id : null
    if (!userId) return fara
    const [prof, acc] = await Promise.all([
      db.from('profiles').select('is_owner, role').eq('id', userId).maybeSingle(),
      db.from('user_module_access').select('module').eq('profile_id', userId).eq('module', MODUL_CERUT).limit(1),
    ])
    if (prof.error || acc.error) return NEVERIFICAT
    return decidePlate({
      userId,
      isOwner: prof.data?.is_owner === true,
      rol: prof.data?.role ?? null,
      areModul: Array.isArray(acc.data) && acc.data.length > 0,
    })
  } catch (_) {
    return NEVERIFICAT
  }
}
