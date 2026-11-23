// ═══════════════════════════════════════════════════════════════════════════
// sesiuneCereri.js — interfața nu mai trimite cereri către tabele FĂRĂ sesiune (12.11.2026, cerut de review-ul PR #1081).
//
// De ce: supabase-js pune în antet tokenul utilizatorului; când nu are sesiune (înainte de login, după logout sau cu sesiunea
// expirată și reîmprospătarea picată, de ex. laptopul trezit din somn fără rețea) pune cheia publică, iar cererea ajunge în bază
// ca „cerere fără cont”. Polling-urile (clopoțelul, chat-ul, „De aprobat”, contoarele) continuau așa în fundal.
//
// Ce face:
//   1. creeazaFetchCuSesiune(cheiePublica): fetch-ul dat clientului Supabase (createClient(..., { global: { fetch } })). O cerere către
//      /rest/v1/ fără tokenul unui utilizator NU pleacă: primește pe loc un răspuns 401 cu codul FARA_SESIUNE (supabase-js îl întoarce
//      ca { error, status: 401 }, fără excepție, fără log). Excepție: RPC-urile paginilor publice (RPC_PUBLICE), care merg fără cont.
//      Autentificarea, fișierele (storage) și funcțiile edge nu sunt atinse. Cu sesiune: nimic nu se schimbă.
//   2. eEroareSesiune(error, status): 401 / 403 sau codurile de JWT lipsă / expirat / FARA_SESIUNE.
//   3. pornestePolling(fn, ms, { client }): rulează fn acum și la fiecare ms; la o eroare de sesiune (fn întoarce { error, status })
//      sau la o cerere blocată de pct. 1 se OPREȘTE (fără buclă, fără zgomot); repornește singur când clientul are din nou sesiune
//      (SIGNED_IN / TOKEN_REFRESHED), se oprește de tot la SIGNED_OUT și la demontare. Eroarea unei cereri pornite ÎNAINTEA
//      ultimului eveniment de sesiune (tokenul vechi) nu oprește polling-ul: se reîncearcă o dată (generația de autentificare).
// Nu schimbă drepturile nimănui: e doar partea de client (drepturile se impun în bază).
// ═══════════════════════════════════════════════════════════════════════════

// RPC-urile apelate FĂRĂ cont de paginile publice (docs/SECURITATE_ANON_DREPTURI.md §2). Rând nou = review nou.
export const RPC_PUBLICE = Object.freeze(['fn_sedinte_rsvp_submit', 'fn_red_formular_public', 'fn_red_raspuns_public', 'fn_red_informare_publicata'])
export const COD_FARA_SESIUNE = 'FARA_SESIUNE'
const CODURI_SESIUNE = new Set([COD_FARA_SESIUNE, 'PGRST301', 'PGRST302', 'PGRST303'])

const ascultatori = new Set()
// abonare la „o cerere a fost blocată fiindcă nu există sesiune” (întoarce dezabonarea)
export function laFaraSesiune(fn) { ascultatori.add(fn); return () => { ascultatori.delete(fn) } }

function caleUrl(input) {
  const s = typeof input === 'string' ? input : (input && typeof input.url === 'string' ? input.url : String(input))
  try { return new URL(s, 'http://local').pathname } catch { return '' }
}
function antetAutorizare(input, init) {
  const h = init && init.headers ? init.headers : (input && typeof input === 'object' ? input.headers : null)
  if (!h) return ''
  if (typeof h.get === 'function') return h.get('Authorization') || ''
  if (Array.isArray(h)) { const p = h.find(x => String(x[0]).toLowerCase() === 'authorization'); return p ? String(p[1]) : '' }
  const k = Object.keys(h).find(x => x.toLowerCase() === 'authorization')
  return k ? String(h[k]) : ''
}

// true = cerere către API-ul de tabele / funcții al bazei fără tokenul unui utilizator (antet lipsă sau = cheia publică),
// în afara RPC-urilor publice
export function eCerereFaraSesiune(input, init, cheiePublica) {
  const p = caleUrl(input)
  if (!p.startsWith('/rest/v1/')) return false
  const tok = antetAutorizare(input, init).replace(/^Bearer\s+/i, '').trim()
  if (tok && tok !== cheiePublica) return false
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)\/?$/.exec(p)
  if (rpc && RPC_PUBLICE.includes(decodeURIComponent(rpc[1]))) return false
  return true
}

export function creeazaFetchCuSesiune(cheiePublica, fetchBaza) {
  return async (input, init) => {
    if (eCerereFaraSesiune(input, init, cheiePublica)) {
      for (const f of [...ascultatori]) { try { f() } catch { /* un ascultător stricat nu oprește garda */ } }
      return new Response(JSON.stringify({ code: COD_FARA_SESIUNE, message: 'Fără sesiune: cererea nu a fost trimisă', details: null, hint: 'Autentifică-te din nou' }),
        { status: 401, statusText: 'Unauthorized', headers: { 'Content-Type': 'application/json' } })
    }
    return (fetchBaza || globalThis.fetch)(input, init)
  }
}

// opțiunile comune pentru createClient în browser (clientul principal și cele locale din module)
export const optiuniClient = (cheiePublica) => ({ global: { fetch: creeazaFetchCuSesiune(cheiePublica) } })

export function eEroareSesiune(error, status) {
  if (status === 401 || status === 403) return true
  if (!error) return false
  if (error.status === 401 || error.status === 403) return true
  return CODURI_SESIUNE.has(error.code)
}

// polling care se oprește fără sesiune și repornește când sesiunea revine.
// Generația de autentificare (review #1082 r2): crește la fiecare SIGNED_IN / TOKEN_REFRESHED / SIGNED_OUT. Un răspuns de sesiune
// (401 / 403) al unei cereri pornite sub o generație mai VECHE nu mai oprește polling-ul (sesiunea s-a schimbat între timp, iar
// eroarea e a tokenului vechi): se reîncearcă O DATĂ pe loc, sub generația curentă; dacă și aceea dă eroare de sesiune, se oprește.
export function pornestePolling(fn, ms, { client = null, imediat = true } = {}) {
  let terminat = false, pauza = false, t = null, ruleaza = false, generatie = 0
  const opresteIntervalul = () => { if (t) { clearInterval(t); t = null } }
  const pune = () => { pauza = true; opresteIntervalul() }
  const pas = async () => {
    if (terminat || pauza || ruleaza) return
    ruleaza = true
    const gen = generatie
    let r
    try { r = await fn() } catch (e) { r = { error: e } } finally { ruleaza = false }
    if (terminat || !r || !eEroareSesiune(r.error, r.status)) return
    if (gen !== generatie) { if (!pauza) pas(); return }   // rezultat învechit: nu oprește; o singură reîncercare (gen nou)
    pune()
  }
  const porneste = (acum) => {
    if (terminat) return
    pauza = false
    opresteIntervalul()
    t = setInterval(pas, ms)
    if (acum) pas()
  }
  const dezabBlocat = laFaraSesiune(pune)
  let dezabAuth = () => {}
  try {
    const sub = client?.auth?.onAuthStateChange?.((ev, sesiune) => {
      if (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED' || ev === 'SIGNED_OUT') generatie++
      if (ev === 'SIGNED_OUT' || !sesiune) pune()
      else if (pauza && (ev === 'SIGNED_IN' || ev === 'TOKEN_REFRESHED')) porneste(true)   // sesiunea a revenit: reîmprospătare imediată
    })
    const s = sub?.data?.subscription
    if (s) dezabAuth = () => s.unsubscribe()
  } catch { /* fără abonare: rămâne oprirea la eroare */ }
  porneste(imediat)
  return () => { terminat = true; opresteIntervalul(); dezabBlocat(); dezabAuth() }
}
