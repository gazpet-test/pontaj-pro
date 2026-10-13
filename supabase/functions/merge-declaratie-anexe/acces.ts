// acces.ts — poarta UI (13.10.2026, inventar securitate): JWT-ul utilizatorului logat + owner SAU intrare explicită
// în user_module_access pentru unul din modulele date. Cheia anon (publică) nu are user → refuz.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export async function userAutorizat(req: Request, sb: SupabaseClient, module: string[]): Promise<string | null> {
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u, error } = await sb.auth.getUser(jwt);
  if (error || !u?.user) return null;
  const { data: prof } = await sb.from("profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
  if (prof?.is_owner === true) return u.user.id;
  if (!module.length) return null;
  const { data: m } = await sb.from("user_module_access").select("module").eq("profile_id", u.user.id).in("module", module).limit(1);
  return m && m.length ? u.user.id : null;
}
