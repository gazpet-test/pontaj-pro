// gmailTrimitere.mjs — transportul Gmail pentru scopul `trimitere` (redari-mail-trimite), docs/redari/PLAN_EMAIL_REDARI.md §1.3 pașii 4–5.
// Doar prin wrapperul gmailHttp.mjs (modulul `gmailTrimitere`: refresh pentru scopul propriu + POST users/me/messages/send). Nu citește
// căsuța, nu știe de alte scopuri, nu păstrează tokenuri între invocări. Rezultatul lui `send` se clasifică în redariMailF2.mjs::rezultatSend.
import { scopuriExacte, corpJson } from './gmailOauthTrimitere.mjs'

/**
 * Refresh token → access token, cu verificarea setului canonic de scope-uri (lipsa câmpului = refuz, §2.3). Întoarce
 * { ok:true, accessToken } | { ok:false, cod: 'token_respins' (4xx determinist: invalid_grant / client) | 'scope_diferit' | 'token_neconfirmat' (5xx / rețea) }.
 */
export async function reimprospateaza(http, refreshToken) {
  let res
  try { res = await http.token({ grant_type: 'refresh_token', refresh_token: refreshToken }) } catch (e) { return { ok: false, cod: e?.message === 'metoda_nepermisa' ? 'metoda_nepermisa' : 'token_neconfirmat' } }
  const t = await corpJson(res)
  if (res.status >= 400 && res.status < 500) return { ok: false, cod: 'token_respins' }
  if (res.status !== 200 || typeof t?.access_token !== 'string' || !t.access_token) return { ok: false, cod: 'token_neconfirmat' }
  if (!scopuriExacte(t.scope, http.scopuriCanonice)) return { ok: false, cod: 'scope_diferit' }
  return { ok: true, accessToken: t.access_token }
}
/** base64url (fără „=”) peste octeții MIME-ului, cum cere câmpul `raw` al Gmail API. */
export function base64Url(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
/** Un singur apel `users.messages.send` cu MIME-ul compus din snapshot; întoarce Response-ul (clasificat de apelant). Niciodată repetat aici. */
export function trimite(http, accessToken, mimeText) {
  const raw = base64Url(new TextEncoder().encode(mimeText))
  return http.gmail('POST', '/gmail/v1/users/me/messages/send', { accessToken, body: JSON.stringify({ raw }) })
}
