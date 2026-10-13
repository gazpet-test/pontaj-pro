// acces.ts — poarta botilor (13.10.2026, fix bot-secret: secretul vechi era in bundle-ul JS si ca fallback in cod).
// Doua cai:
//   'cron' — antet x-bot-secret, verificat IN BAZA DE DATE (fn_bot_secret_ok: sha256 comparat cu secretul BOT_SECRET
//            din Vault; doar service_role are EXECUTE). Fara fallback: lipsa/eroare = refuz.
//   'ui'   — JWT-ul utilizatorului logat + owner SAU intrare explicita in user_module_access pentru modulele date.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type Cale = "cron" | "ui" | null;

export async function autorizeaza(req: Request, sb: SupabaseClient, moduleUi: string[] = []): Promise<Cale> {
  const secret = req.headers.get("x-bot-secret");
  if (secret) {
    const { data, error } = await sb.rpc("fn_bot_secret_ok", { p_secret: secret });
    return !error && data === true ? "cron" : null;
  }
  if (!moduleUi.length) return null;
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data: u, error: eu } = await sb.auth.getUser(jwt);
  if (eu || !u?.user) return null;
  const { data: prof } = await sb.from("profiles").select("is_owner").eq("id", u.user.id).maybeSingle();
  if (prof?.is_owner === true) return "ui";
  const { data: m } = await sb.from("user_module_access").select("module").eq("profile_id", u.user.id).in("module", moduleUi).limit(1);
  return m && m.length ? "ui" : null;
}
