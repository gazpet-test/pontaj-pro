// gmailOauthTrimitere.mjs — logica PURĂ a conectării căsuței redari@gazpet.ro pentru scopul `trimitere` (gmail.send + openid email),
// docs/redari/PLAN_EMAIL_REDARI.md §2.3. Fără rețea proprie: toate cererile trec prin wrapperul gmailHttp.mjs (lista închisă a modulului
// `gmailOauth`). Răspunsurile Google sunt DATE (pct. 10): se verifică forma, nimic nu se execută din ele.
//   * scope-urile se compară ca SETURI CANONICE, prin lista închisă de echivalențe (altceva = diferit; câmp absent = refuz);
//   * căsuța se dovedește din id_token validat LOCAL (semnătura RS256 cu cheile JWKS Google prin WebCrypto, iss / aud / exp / iat /
//     email_verified / email / hd), nu din login_hint și nici din tokeninfo;
//   * orice nepotrivire → revocare imediată la Google și nimic salvat (decizia o ia handlerul, cu funcțiile de aici).
export const REDIRECT_URI_TRIMITERE = 'https://pontaj-pro-sooty.vercel.app/redari/mail-oauth'
export const EMITENTI = Object.freeze(['accounts.google.com', 'https://accounts.google.com'])
export const DOMENIU_WORKSPACE = 'gazpet.ro'
const ECHIVALENTE = Object.freeze({
  email: 'email', 'https://www.googleapis.com/auth/userinfo.email': 'email', openid: 'openid',
  'https://www.googleapis.com/auth/gmail.readonly': 'gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify': 'gmail.modify',
  'https://www.googleapis.com/auth/gmail.send': 'gmail.send',
})
/** Setul canonic (sortat, fără duplicate) al unui câmp `scope`; null dacă lipsește / nu e text. Necunoscutele rămân ca atare (= diferit). */
export function scopuriCanonice(scope) {
  if (typeof scope !== 'string') return null
  const set = new Set(scope.split(/[ \t]+/).filter(Boolean).map(s => ECHIVALENTE[s] ?? s))
  return [...set].sort()
}
/** Exact setul așteptat, după normalizare: nimic în plus, nimic lipsă; câmp absent → false. */
export function scopuriExacte(scope, asteptate) {
  const c = scopuriCanonice(scope)
  if (!c) return false
  const a = [...new Set(asteptate)].sort()
  return c.length === a.length && c.every((s, i) => s === a[i])
}
/** state aleator: 32 de octeți hex (64 caractere); în BD stă doar sha256-ul lui. */
export const stateValid = s => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)
export function genereazaState(getRandomValues = v => crypto.getRandomValues(v)) {
  return Array.from(getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('')
}
export async function sha256Hex(s) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('')
}
/** URL-ul de autorizare: access_type=offline, prompt=consent, include_granted_scopes=false, login_hint + hd (doar sugestii pentru ecran). */
export function urlAutorizare({ clientId, state, scope, casuta, redirectUri = REDIRECT_URI_TRIMITERE }) {
  if (!stateValid(state) || typeof clientId !== 'string' || !clientId) throw new Error('cerere_invalida')
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', login_hint: casuta, hd: DOMENIU_WORKSPACE })) u.searchParams.set(k, v)
  return u.toString()
}
const b64urlDecode = s => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(t + '='.repeat((4 - t.length % 4) % 4))
  return Uint8Array.from(bin, c => c.charCodeAt(0))
}
const jsonDin = bytes => { try { const v = JSON.parse(new TextDecoder().decode(bytes)); return v && typeof v === 'object' ? v : null } catch { return null } }
/**
 * Validarea locală a id_token-ului (RS256, JWKS Google). `jwks` = () => Promise<{keys:[...]}> (prin wrapper). Întoarce { ok:true, email, hd }
 * sau { ok:false, cod } cu codul exact al primei verificări căzute. `acum` în ms. Fără librărie nouă: WebCrypto.
 */
export async function valideazaIdToken(idToken, { jwks, clientId, casuta, acum = Date.now(), subtle = crypto.subtle }) {
  if (typeof idToken !== 'string' || idToken.length > 8192) return { ok: false, cod: 'id_token_lipsa' }
  const parti = idToken.split('.')
  if (parti.length !== 3 || parti.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) return { ok: false, cod: 'id_token_forma' }
  const antet = jsonDin(b64urlDecode(parti[0])), corp = jsonDin(b64urlDecode(parti[1]))
  if (!antet || !corp) return { ok: false, cod: 'id_token_forma' }
  if (antet.alg !== 'RS256' || typeof antet.kid !== 'string' || !antet.kid) return { ok: false, cod: 'id_token_alg' }
  let set
  try { set = await jwks() } catch { return { ok: false, cod: 'jwks_indisponibil' } }
  const cheie = Array.isArray(set?.keys) ? set.keys.find(k => k && k.kid === antet.kid && k.kty === 'RSA' && (k.alg === undefined || k.alg === 'RS256') && (k.use === undefined || k.use === 'sig')) : null
  if (!cheie) return { ok: false, cod: 'id_token_cheie' }
  let valid = false
  try {
    const k = await subtle.importKey('jwk', { kty: 'RSA', n: cheie.n, e: cheie.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    valid = await subtle.verify('RSASSA-PKCS1-v1_5', k, b64urlDecode(parti[2]), new TextEncoder().encode(parti[0] + '.' + parti[1]))
  } catch { valid = false }
  if (!valid) return { ok: false, cod: 'id_token_semnatura' }
  const sec = Math.floor(acum / 1000)
  if (!EMITENTI.includes(corp.iss)) return { ok: false, cod: 'id_token_iss' }
  if (corp.aud !== clientId) return { ok: false, cod: 'id_token_aud' }
  if (!Number.isFinite(corp.exp) || corp.exp <= sec) return { ok: false, cod: 'id_token_exp' }
  if (!Number.isFinite(corp.iat) || corp.iat > sec + 300 || corp.iat < sec - 600) return { ok: false, cod: 'id_token_iat' }
  if (corp.email_verified !== true) return { ok: false, cod: 'id_token_neverificat' }
  if (typeof corp.email !== 'string' || corp.email.toLowerCase() !== casuta || corp.email !== corp.email.toLowerCase()) return { ok: false, cod: 'casuta_gresita' }
  if (corp.hd !== DOMENIU_WORKSPACE) return { ok: false, cod: 'id_token_hd' }
  return { ok: true, email: corp.email, hd: corp.hd }
}
/** Corpul JSON al unui răspuns, fără să arunce; răspuns neinterpretabil = null. */
export async function corpJson(res) { try { const v = await res.json(); return v && typeof v === 'object' ? v : null } catch { return null } }
/**
 * Verificările răspunsului de token la callback: scope exact, refresh_token prezent, id_token valid pentru căsuța scopului.
 * Întoarce { ok:true, refresh_token, access_token, email } sau { ok:false, cod, deRevocat: [tokenuri] } — handlerul revocă și nu salvează.
 */
export async function verificaRaspunsToken(t, { http, clientId, acum, subtle }) {
  const deRevocat = [t?.refresh_token, t?.access_token].filter(v => typeof v === 'string' && v)
  if (!t || typeof t.access_token !== 'string' || !t.access_token) return { ok: false, cod: 'schimb_esuat', deRevocat }
  if (!scopuriExacte(t.scope, http.scopuriCanonice)) return { ok: false, cod: 'scope_diferit', deRevocat }
  if (typeof t.refresh_token !== 'string' || !t.refresh_token) return { ok: false, cod: 'fara_refresh_token', deRevocat }
  const v = await valideazaIdToken(t.id_token, { jwks: async () => corpJson(await http.jwks()), clientId, casuta: http.casuta, acum, subtle })
  if (!v.ok) return { ok: false, cod: v.cod, deRevocat }
  return { ok: true, refresh_token: t.refresh_token, access_token: t.access_token, email: v.email }
}
