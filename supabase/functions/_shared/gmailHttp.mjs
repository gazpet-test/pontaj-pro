// gmailHttp.mjs — SINGURUL loc din supabase/functions/ care are voie să facă fetch spre Google pentru e-mailul Redări
// (docs/redari/PLAN_EMAIL_REDARI.md §1 „Wrapper HTTP unic”, §2.3 „Maparea unică”). Fiecare modul se înregistrează cu o listă ÎNCHISĂ
// (metodă, cale) și cu UN singur scop; orice altă gazdă / cale / metodă / grant_type / scop e refuzată ÎNAINTE de rețea (eroare
// `metoda_nepermisa`, fără apel). Secretele clientului OAuth (client_id / client_secret) se citesc DOAR aici, din mediul primit
// (`env(nume)`), prin numele din mapare, și DOAR la cererile de token — modulele nu le ating. Fără console.* cu corpuri sau tokenuri.
// Felia F2b (18.11.2026): un singur scop, `trimitere` (gmail.send + openid email); citirea / golirea (F1) își adaugă scopurile aici, cu
// listele lor, când se livrează.
export const GAZDA_GMAIL = 'https://gmail.googleapis.com'
export const GAZDA_OAUTH = 'https://oauth2.googleapis.com'
export const GAZDA_JWKS = 'https://www.googleapis.com'
export const CALE_TOKEN = '/token', CALE_REVOCARE = '/revoke', CALE_JWKS = '/oauth2/v3/certs'

/** Maparea unică §2.3: scop → numele secretelor (Edge Secrets pentru client, Vault pentru refresh token) → căsuța așteptată → scope-urile. */
export const MAPARE_SCOPURI = Object.freeze({
  trimitere: Object.freeze({
    client_id_env: 'REDARI_GMAIL_TRIMITERE_CLIENT_ID', client_secret_env: 'REDARI_GMAIL_TRIMITERE_CLIENT_SECRET',
    vault: 'REDARI_GMAIL_TRIMITERE_REFRESH_TOKEN', casuta: 'redari@gazpet.ro',
    scope_cerut: 'https://www.googleapis.com/auth/gmail.send openid email', scopuri_canonice: Object.freeze(['email', 'gmail.send', 'openid']),
  }),
})
/** Listele închise pe modul: cererile Gmail (metodă + cale exactă) și operațiile OAuth permise. */
export const LISTE_MODULE = Object.freeze({
  // transportul (redari-mail-trimite): doar trimiterea + reîmprospătarea tokenului scopului propriu
  gmailTrimitere: Object.freeze({ scopuri: ['trimitere'], gmail: [['POST', '/gmail/v1/users/me/messages/send']], oauth: ['refresh_token'] }),
  // conectarea / revocarea (redari-mail-oauth): schimbul codului, revocarea, cheile JWKS; nicio cerere Gmail (căsuța se verifică din id_token)
  gmailOauth: Object.freeze({ scopuri: ['trimitere'], gmail: [], oauth: ['authorization_code', 'revoke', 'jwks'] }),
})
const refuz = (detaliu) => { const e = new Error('metoda_nepermisa'); e.detaliu = detaliu; return e }
const text = v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(v)

/**
 * Creează wrapperul pentru UN modul și UN scop. `env(nume)` întoarce valoarea unui secret de mediu (doar numele din mapare sunt cerute);
 * `fetch` e injectat (în teste: interceptat). Întoarce funcții care verifică lista înainte de fiecare apel.
 */
export function creeazaGmailHttp({ modul, scop, env, fetch: f }) {
  const lista = LISTE_MODULE[modul]
  if (!lista) throw refuz(`modul necunoscut: ${String(modul)}`)
  if (!lista.scopuri.includes(scop) || !MAPARE_SCOPURI[scop]) throw refuz(`scopul ${String(scop)} nu e al modulului ${modul}`)
  if (typeof env !== 'function' || typeof f !== 'function') throw refuz('env / fetch lipsă')
  const map = MAPARE_SCOPURI[scop]
  const clientId = () => { const v = env(map.client_id_env); if (!text(v)) throw new Error('client_neconfigurat'); return v }
  const clientSecret = () => { const v = env(map.client_secret_env); if (!text(v)) throw new Error('client_neconfigurat'); return v }
  const form = (p) => new URLSearchParams(p).toString()
  const post = (url, body, antete = {}) => f(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...antete }, body })
  return Object.freeze({
    modul, scop, casuta: map.casuta, scopuriCanonice: map.scopuri_canonice, scopeCerut: map.scope_cerut, clientId,
    /** Cerere Gmail API: doar (metodă, cale) din lista modulului; tokenul de acces doar în antet. */
    gmail(metoda, cale, { accessToken, body } = {}) {
      if (!lista.gmail.some(([m, c]) => m === metoda && c === cale)) throw refuz(`${metoda} ${cale} nu e în lista ${modul}`)
      if (!text(accessToken)) throw refuz('access token lipsă')
      return f(GAZDA_GMAIL + cale, { method: metoda, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body })
    },
    /** POST oauth2.googleapis.com/token cu grant_type din lista modulului; client_id / client_secret din mapare (niciodată din parametri). */
    token(p) {
      const g = p?.grant_type
      if (!lista.oauth.includes(g)) throw refuz(`grant_type ${String(g)} nu e în lista ${modul}`)
      if (p.client_id !== undefined || p.client_secret !== undefined) throw refuz('client_id / client_secret nu se primesc din afara wrapperului')
      const corp = { grant_type: g, client_id: clientId(), client_secret: clientSecret() }
      if (g === 'authorization_code') {
        if (!text(p.code) || !text(p.redirect_uri)) throw refuz('authorization_code cere code + redirect_uri')
        Object.assign(corp, { code: p.code, redirect_uri: p.redirect_uri })
      } else if (g === 'refresh_token') {
        if (!text(p.refresh_token)) throw refuz('refresh_token lipsă')
        corp.refresh_token = p.refresh_token
      } else throw refuz(`grant_type ${g} fără formă`)
      return post(GAZDA_OAUTH + CALE_TOKEN, form(corp))
    },
    /** POST oauth2.googleapis.com/revoke: tokenul scopului (refresh sau access), nimic altceva. */
    revoca(token) {
      if (!lista.oauth.includes('revoke')) throw refuz(`revocarea nu e în lista ${modul}`)
      if (!text(token)) throw refuz('token de revocat lipsă')
      return post(GAZDA_OAUTH + CALE_REVOCARE, form({ token }))
    },
    /** GET www.googleapis.com/oauth2/v3/certs (cheile publice pentru id_token). */
    jwks() {
      if (!lista.oauth.includes('jwks')) throw refuz(`JWKS nu e în lista ${modul}`)
      return f(GAZDA_JWKS + CALE_JWKS, { method: 'GET' })
    },
  })
}
