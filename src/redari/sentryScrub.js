// Redări teren — protecția tokenului public (/redari/raspuns/<token>) în telemetria Sentry (review Jakarinos r1…r6).
// Modul pur (fără React, fără Sentry): beforeSend / beforeSendTransaction în src/main.jsx; testat cu vitest (sentryScrub.test.js).
//
// STRATEGIA (r6): nu ne bazăm pe completitudinea redactării.
//  (1) DROP total pe formularul public: dacă pagina curentă e /redari/raspuns…, sau request.url / transaction / orice URL de breadcrumb
//      (brut sau decodat) conține `/redari/raspuns`, `rpc/fn_red_formular_public` sau `rpc/fn_red_raspuns_public` ⇒ null. Nimic de pe
//      formularul public nu ajunge la Sentry.
//  (2) Pentru restul: colectare globală a tokenurilor (valoarea de 43 a oricărei chei cu „token” în nume + tokenul de 43 după raspuns/
//      sau p_token din orice șir sau cheie, în toate formele decodate), apoi înlocuire globală (literal + codificat simplu/dublu) în toate
//      șirurile și cheile; request.data / request.body se elimină dacă poartă token sau URL-ul e un RPC al modulului.
//  (3) VERIFICAREA FINALĂ pe evenimentul serializat (safe la cicluri): formele [brut, dec1, dec2, dec3] cu un decodor care decodează ORICE
//      %XX valid; pe FIECARE formă se caută orice token colectat, regex-ul (raspuns|token)…<43>, `/redari/raspuns` și — pentru evenimentele
//      care au purtat token — orice alt șir de 43 [A-Za-z0-9_-] rămas. Dacă ceva se potrivește ⇒ null (evenimentul se pierde, acceptat).
//  (4) La ORICE excepție ⇒ null. Niciodată evenimentul brut, niciodată o „variantă minimă”.

const TOKEN = '[token]'
const RX_CALE = /\/redari\/raspuns\/([^\s/?#"'&]+)/g
const RX_CALE_ENC = /%2Fredari%2Fraspuns%2F([^\s/?#"'&%]+)/gi
// `raspuns/` sau `raspuns%2F`, apoi tokenul de 43; `p_token`, până la 16 separatoare (non-token sau %XX), apoi tokenul de 43
const RX_TOKEN_RASPUNS = /(raspuns(?:\/|%2F))([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
const RX_TOKEN_P_TOKEN = /(p_token(?:%[0-9A-Fa-f]{2}|[^A-Za-z0-9_-]){0,16})([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
const RX_T43 = /^[A-Za-z0-9_-]{43}$/
const RX_T43_ORIUNDE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/
const RX_DROP = /\/redari\/raspuns|rpc\/fn_red_formular_public|rpc\/fn_red_raspuns_public/i
const RX_FINAL = /(raspuns|token)[^A-Za-z0-9_-]{0,16}[A-Za-z0-9_-]{43}/i
const RX_RASPUNS_PUBLIC = /\/redari\/raspuns/i
const MAX_DECODARI = 3
const MIN_LUNGIME_COADA = 16

const pareSuspect = (s) => /redari|raspuns|p_token/i.test(s)
const cheieDeToken = (cheie) => typeof cheie === 'string' && /token/i.test(cheie)

// Decodează ORICE secvență %XX validă (litere, cifre, separatoare), o dată; secvențele invalide rămân.
const decodeazaOdata = (s) => {
  try { return decodeURIComponent(s) }
  catch { return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => { try { return decodeURIComponent(m) } catch { return m } }) }
}
// [brut, dec1, dec2, dec3] — până la MAX_DECODARI sau până nu se mai schimbă
export const formele = (s) => {
  const lista = [s]
  let curent = s
  for (let i = 0; i < MAX_DECODARI; i++) {
    if (!curent.includes('%')) break
    const d = decodeazaOdata(curent)
    if (d === curent) break
    lista.push(d); curent = d
  }
  return lista
}
const colecteazaTokenuri = (forma, set) => {
  for (const rx of [RX_CALE, RX_CALE_ENC, RX_TOKEN_RASPUNS, RX_TOKEN_P_TOKEN]) {
    rx.lastIndex = 0
    for (const m of forma.matchAll(rx)) { const t = m[m.length - 1]; if (t && t !== TOKEN && t.length >= MIN_LUNGIME_COADA) set.add(t) }
  }
}
const aplicaRegulileDeCale = (s) => s
  .replace(RX_CALE_ENC, `%2Fredari%2Fraspuns%2F${TOKEN}`)
  .replace(RX_CALE, `/redari/raspuns/${TOKEN}`)
  .replace(RX_TOKEN_RASPUNS, (_, prefix) => `${prefix}${TOKEN}`)
  .replace(RX_TOKEN_P_TOKEN, (_, prefix) => `${prefix}${TOKEN}`)
const varianteToken = (t) => new Set([t, encodeURIComponent(t), encodeURIComponent(encodeURIComponent(t))])

// Redactarea unui șir: tokenurile globale (din tot evenimentul) + tokenurile din propriile forme + regulile de cale.
export function redacteazaText(s, tokenuriGlobale = null) {
  if (typeof s !== 'string') return s
  const forme = formele(s)
  const tokenuri = new Set(tokenuriGlobale || [])
  let rezultat = s
  for (const t of tokenuri) for (const v of varianteToken(t)) rezultat = rezultat.split(v).join(TOKEN)
  if (!forme.some(pareSuspect)) return rezultat
  for (const f of forme) colecteazaTokenuri(f, tokenuri)
  rezultat = aplicaRegulileDeCale(rezultat)
  for (const t of tokenuri) for (const v of varianteToken(t)) rezultat = rezultat.split(v).join(TOKEN)
  return rezultat
}

// Parcurgere iterativă generică (fără recursivitate, fără limită de adâncime), cu set de vizitate pentru cicluri.
function parcurge(radacina, fn, fnCheie = null) {
  if (radacina === null || typeof radacina !== 'object') return radacina
  const vizitate = new WeakSet()
  const stiva = [radacina]
  while (stiva.length) {
    const obj = stiva.pop()
    if (obj === null || typeof obj !== 'object' || vizitate.has(obj)) continue
    vizitate.add(obj)
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i]
        if (v && typeof v === 'object') stiva.push(v)
        else { const n = fn(obj, null, v); if (n !== v) obj[i] = n }
      }
      continue
    }
    for (const cheie of Object.keys(obj)) {
      const v = obj[cheie]
      const cheieNoua = fnCheie ? fnCheie(cheie) : cheie
      if (cheieNoua !== cheie) delete obj[cheie]
      let vNou = v
      if (v && typeof v === 'object') stiva.push(v)
      else vNou = fn(obj, cheie, v)
      if (cheieNoua !== cheie || vNou !== v) obj[cheieNoua] = vNou
    }
  }
  return radacina
}

// (2a) tokenurile candidate din întreg evenimentul
export function colecteazaTokenuriEveniment(event) {
  const tokenuri = new Set()
  const dinText = (s) => { if (typeof s === 'string' && pareSuspect(s)) for (const f of formele(s)) colecteazaTokenuri(f, tokenuri) }
  parcurge(event, (_obj, cheie, v) => {
    if (typeof v === 'string') {
      if (cheieDeToken(cheie) && RX_T43.test(v)) tokenuri.add(v)
      dinText(v)
    }
    return v
  }, (cheie) => { dinText(cheie); return cheie })
  return tokenuri
}

// (2b) înlocuire globală în toate șirurile și cheile; valorile de 43 ale cheilor cu „token” în nume → [token]. Mută în loc.
export function redacteazaAdanc(radacina, tokenuriGlobale = null) {
  if (radacina === null || typeof radacina !== 'object') return typeof radacina === 'string' ? redacteazaText(radacina, tokenuriGlobale) : radacina
  return parcurge(radacina,
    (_obj, cheie, v) => {
      if (typeof v !== 'string') return v
      if (cheieDeToken(cheie) && RX_T43.test(v)) return TOKEN
      return redacteazaText(v, tokenuriGlobale)
    },
    (cheie) => redacteazaText(cheie, tokenuriGlobale))
}

// serializare sigură la cicluri, pentru verificări
const serializeaza = (obj) => {
  const vizitate = new WeakSet()
  return JSON.stringify(obj, (_k, v) => {
    if (v && typeof v === 'object') { if (vizitate.has(v)) return '[ciclu]'; vizitate.add(v) }
    return v
  }) ?? ''
}
const contineVreunToken = (text, tokenuri) => {
  for (const t of tokenuri) for (const v of varianteToken(t)) if (text.includes(v)) return true
  return false
}
const vreoFormaSePotriveste = (s, rx) => typeof s === 'string' && formele(s).some(f => rx.test(f))

// (1) evenimentul vine de pe formularul public? — pagina curentă, URL-ul cererii, transaction, URL-urile din breadcrumb-uri
export function esteDinFormularulPublic(event) {
  if (typeof window !== 'undefined' && RX_RASPUNS_PUBLIC.test(String(window.location?.pathname || ''))) return true
  const e = event || {}
  if (vreoFormaSePotriveste(e.request?.url, RX_DROP) || vreoFormaSePotriveste(e.transaction, RX_DROP)) return true
  const bc = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : (Array.isArray(e.breadcrumbs?.values) ? e.breadcrumbs.values : [])
  for (const b of bc) {
    if (!b || typeof b !== 'object') continue
    for (const u of [b.url, b.data?.url, b.data?.to, b.data?.from, b.message]) if (vreoFormaSePotriveste(u, RX_DROP)) return true
  }
  return false
}

// (3) verificarea finală pe serializare, pe toate formele decodate
export function maiScurgeToken(event, tokenuri) {
  const text = serializeaza(event)
  for (const f of formele(text)) {
    if (contineVreunToken(f, tokenuri)) return true
    if (RX_FINAL.test(f) || RX_RASPUNS_PUBLIC.test(f)) return true
    if (tokenuri.size && RX_T43_ORIUNDE.test(f)) return true   // a purtat token: orice alt șir de 43 rămas e suspect
  }
  return false
}

// beforeSend / beforeSendTransaction
export function scrubSentryEvent(event) {
  try {
    if (event === null || typeof event !== 'object') return null
    if (esteDinFormularulPublic(event)) return null
    const tokenuri = colecteazaTokenuriEveniment(event)
    const req = event.request
    if (req && typeof req === 'object') {
      const corp = serializeaza({ data: req.data, body: req.body })
      const urlRpc = vreoFormaSePotriveste(typeof req.url === 'string' ? req.url : '', /rpc\/fn_red_/i)
      if (urlRpc || contineVreunToken(corp, tokenuri) || /p_token|raspuns/i.test(corp)) { delete req.data; delete req.body }
    }
    redacteazaAdanc(event, tokenuri)
    if (maiScurgeToken(event, tokenuri)) return null
    return event
  } catch {
    return null
  }
}
