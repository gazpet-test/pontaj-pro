// redariMailOauthHandler.mjs — handler testabil pentru funcția edge redari-mail-oauth (F2b: scopul `trimitere`), fără rețea implicită.
// Plan: docs/redari/PLAN_EMAIL_REDARI.md §2.3 (callback-ul OAuth, maparea unică, fișa a–e). Acțiuni (POST JSON {actiune}), toate cu JWT-ul
// OWNER-ULUI (getUser + fn_sms_e_owner în BD; nimic din corp nu e identitate, L08):
//   start    {scop:'trimitere'} → state aleator (sha256 în BD, legat de owner + scop, 10 min) → URL-ul de autorizare Google;
//   callback {code, state}      → state-ul CONSUMAT ATOMIC în BD (o singură dată, doar al owner-ului curent, neexpirat) → schimbul codului →
//                                  scope-urile exacte + id_token validat local (căsuța = redari@gazpet.ro) → refresh token-ul în Vault prin RPC-ul
//                                  service_role (p_apelant = uid-ul din getUser). Orice nepotrivire → revocare imediată la Google, nimic salvat;
//   revoca                      → revocarea la Google (best-effort) + golirea secretului + trimitere_oprita = true (în același RPC).
// Redirect URI = pagina ERP /redari/mail-oauth (ca la ViCare): Google întoarce code + state în browserul owner-ului, iar pagina le trimite aici cu
// JWT-ul lui — deci callback-ul NU e un endpoint public fără JWT. Răspunsurile Google sunt date (pct. 10).
import { creeazaGmailHttp } from './gmailHttp.mjs'
import { genereazaState, sha256Hex, stateValid, urlAutorizare, verificaRaspunsToken, tokenuriDeRevocat, corpJson, REDIRECT_URI_TRIMITERE } from './gmailOauthTrimitere.mjs'

export const SCOPURI_F2B = Object.freeze(['trimitere'])
export const ACTIUNI_OAUTH = Object.freeze(['start', 'callback', 'revoca'])
const CODE = /^[A-Za-z0-9_\-/.~%]{8,512}$/

export async function raspundeOauth({ jwt, corp }, deps) {
  const out = (status, cod, extra = {}) => ({ status, body: { cod, ...extra } })
  if (!jwt) return out(401, 'neautentificat')
  const user = await deps.getUser()
  if (user?.error) return Number.isInteger(user.error.status) && user.error.status >= 400 && user.error.status < 500 ? out(401, 'neautentificat') : out(503, 'autentificare_neconfirmata')
  const uid = user?.data?.user?.id
  if (!uid) return out(401, 'neautentificat')
  const owner = await deps.owner()
  if (owner?.error) return out(503, 'autorizare_neconfirmata')
  if (owner?.data !== true) return out(403, 'non_owner')
  if (!corp || typeof corp !== 'object' || !ACTIUNI_OAUTH.includes(corp.actiune)) return out(400, 'cerere_invalida')
  const eveniment = async (tip, cod) => { try { await deps.eveniment(tip, cod) } catch { /* evenimentul e jurnal, nu poartă */ } }

  if (corp.actiune === 'start') {
    if (!SCOPURI_F2B.includes(corp.scop)) return out(400, 'scop_nepermis')
    let http
    try { http = creeazaGmailHttp({ modul: 'gmailOauth', scop: corp.scop, env: deps.env, fetch: deps.fetch }) } catch { return out(503, 'transport_neconfigurat') }
    let clientId
    try { clientId = http.clientId() } catch { return out(503, 'client_neconfigurat') }
    const state = genereazaState(deps.getRandomValues)
    const r = await deps.stateStart(corp.scop, await sha256Hex(state))
    if (r?.error || !r?.data) return out(503, 'state_neconfirmat')
    return out(200, 'start', { url: urlAutorizare({ clientId, state, scope: http.scopeCerut, casuta: http.casuta, redirectUri: REDIRECT_URI_TRIMITERE }) })
  }
  if (corp.actiune === 'callback') {
    if (!stateValid(corp.state) || typeof corp.code !== 'string' || !CODE.test(corp.code)) return out(400, 'cerere_invalida')
    // consumul atomic al state-ului: UPDATE … WHERE sha = … AND consumat_la IS NULL AND expira_la > now() AND owner_id = auth.uid() RETURNING scop
    const st = await deps.stateConsuma(await sha256Hex(corp.state))
    if (st?.error) return out(st.error.cod === 'state_invalid' ? 409 : 503, st.error.cod === 'state_invalid' ? 'state_invalid' : 'state_neconfirmat')
    const scop = st?.data
    if (!SCOPURI_F2B.includes(scop)) return out(409, 'state_invalid')
    let http
    try { http = creeazaGmailHttp({ modul: 'gmailOauth', scop, env: deps.env, fetch: deps.fetch }) } catch { return out(503, 'transport_neconfigurat') }
    let res, t = null
    try { res = await http.token({ grant_type: 'authorization_code', code: corp.code, redirect_uri: REDIRECT_URI_TRIMITERE }); t = await corpJson(res) }
    catch { await eveniment('oauth_respins', 'schimb_esuat'); return out(502, 'schimb_esuat') }
    if (res.status !== 200 || !t) { await eveniment('oauth_respins', 'schimb_esuat'); return out(502, 'schimb_esuat') }
    // verificarea nu aruncă; dacă totuși ar arunca (runda 2, P2), grantul primit se revocă oricum și refuzul e controlat (id_token_forma)
    let v
    try { v = await verificaRaspunsToken(t, { http, clientId: http.clientId(), acum: deps.acum?.() ?? Date.now(), subtle: deps.subtle }) }
    catch { v = { ok: false, cod: 'id_token_forma', deRevocat: tokenuriDeRevocat(t) } }
    if (!v.ok) {
      for (const tk of v.deRevocat) { try { await http.revoca(tk) } catch { /* revocarea e best-effort; nimic salvat oricum */ } }
      await eveniment('oauth_respins', v.cod)
      return out(409, v.cod)
    }
    // salvarea: RPC service_role cu p_apelant = uid-ul din getUser (regula (ii) din §2.4); eșec = revocare, nimic rămâne la Google
    const w = await deps.secretSeteaza(v.refresh_token, uid, v.email)
    if (w?.error || w?.data !== true) {
      for (const tk of [v.refresh_token, v.access_token]) { try { await http.revoca(tk) } catch { /* idem */ } }
      return out(503, 'salvare_neconfirmata')
    }
    return out(200, 'conectat', { casuta: v.email })
  }
  // revoca
  const sec = await deps.secretCiteste(uid, 'revocare')
  if (sec?.error) return out(503, 'secret_neconfirmat')
  if (typeof sec?.data === 'string' && sec.data) {
    try { const http = creeazaGmailHttp({ modul: 'gmailOauth', scop: 'trimitere', env: deps.env, fetch: deps.fetch }); await http.revoca(sec.data) } catch { /* best-effort */ }
  }
  const w = await deps.secretSeteaza('', uid, null)
  if (w?.error || w?.data !== true) return out(503, 'salvare_neconfirmata')
  return out(200, 'revocat')
}
