// Redări teren — redactarea tokenului public (/redari/raspuns/<token>) din evenimentele Sentry (review Jakarinos P1-4 / P2-3).
// Modul pur (fără React, fără Sentry): se folosește ca beforeSend / beforeSendTransaction în src/main.jsx și se testează cu vitest.
//
// Ce se redactează, în orice șir din eveniment (valori ȘI chei de obiect), la orice adâncime (parcurgere iterativă, cu set de vizitate):
//  1. `/redari/raspuns/<orice>`                    → `/redari/raspuns/[token]`
//  2. `%2Fredari%2Fraspuns%2F<orice>` (URL-encoded) → `%2Fredari%2Fraspuns%2F[token]`
//  3. un token de 43 caractere [A-Za-z0-9_-] precedat de `raspuns/` sau de `p_token` (ex. corpul unui RPC: `"p_token":"…"`) → `[token]`
// Dacă parcurgerea aruncă (getter care aruncă, structuri exotice), NU se întoarce evenimentul brut: se întoarce o variantă minimă,
// fără request.url / breadcrumbs / spans / contexts / extra, cu transaction/message redactate.

const TOKEN = '[token]'
const RX_CALE = /\/redari\/raspuns\/[^\s/?#"'&]+/g
const RX_CALE_ENC = /%2Fredari%2Fraspuns%2F[^\s/?#"'&%]+/gi
// `raspuns/<43>` sau `p_token` urmat de orice separator (: = " ' spații) și apoi `<43>`; tokenul nu e urmat de alt caracter de token
const RX_TOKEN_CONTEXT = /(raspuns\/|p_token[^A-Za-z0-9_-]{0,6})([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g

const pareSuspect = (s) => s.includes('/redari/raspuns/') || /%2Fredari%2Fraspuns%2F/i.test(s) || s.includes('raspuns/') || s.includes('p_token')

export function redacteazaText(s) {
  if (typeof s !== 'string' || !pareSuspect(s)) return s
  return s
    .replace(RX_CALE_ENC, `%2Fredari%2Fraspuns%2F${TOKEN}`)
    .replace(RX_CALE, `/redari/raspuns/${TOKEN}`)
    .replace(RX_TOKEN_CONTEXT, (_, prefix) => `${prefix}${TOKEN}`)
}

// Parcurgere iterativă (fără recursivitate, fără limită de adâncime), cu set de vizitate pentru cicluri. Mută în loc.
export function redacteazaAdanc(radacina) {
  if (radacina === null || typeof radacina !== 'object') return typeof radacina === 'string' ? redacteazaText(radacina) : radacina
  const vizitate = new WeakSet()
  const stiva = [radacina]
  while (stiva.length) {
    const obj = stiva.pop()
    if (obj === null || typeof obj !== 'object' || vizitate.has(obj)) continue
    vizitate.add(obj)
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i]
        if (typeof v === 'string') obj[i] = redacteazaText(v)
        else if (v && typeof v === 'object') stiva.push(v)
      }
      continue
    }
    for (const cheie of Object.keys(obj)) {
      const v = obj[cheie]
      const cheieNoua = redacteazaText(cheie)
      if (cheieNoua !== cheie) { delete obj[cheie] }
      let vNou = v
      if (typeof v === 'string') vNou = redacteazaText(v)
      else if (v && typeof v === 'object') stiva.push(v)
      if (cheieNoua !== cheie || vNou !== v) obj[cheieNoua] = vNou
    }
  }
  return radacina
}

// Varianta minimă, folosită DOAR când parcurgerea completă a aruncat: păstrează ce e util pentru diagnostic, fără câmpurile cu URL-uri.
export function evenimentMinim(event) {
  const e = (event && typeof event === 'object') ? event : {}
  const sigur = (v) => (typeof v === 'string' ? redacteazaText(v) : undefined)
  const minim = {
    event_id: typeof e.event_id === 'string' ? e.event_id : undefined,
    timestamp: e.timestamp,
    platform: typeof e.platform === 'string' ? e.platform : undefined,
    level: typeof e.level === 'string' ? e.level : undefined,
    environment: typeof e.environment === 'string' ? e.environment : undefined,
    release: typeof e.release === 'string' ? e.release : undefined,
    transaction: sigur(e.transaction),
    message: sigur(typeof e.message === 'string' ? e.message : e.message?.formatted),
    tags: { ...(e.tags && typeof e.tags === 'object' ? {} : {}), sentry_scrub: 'minim' },
  }
  // excepția: doar tipul + mesajul (redactate), fără stack cu URL-uri
  const valori = e.exception?.values
  if (Array.isArray(valori)) {
    minim.exception = { values: valori.slice(0, 5).map(x => ({ type: sigur(x?.type), value: sigur(x?.value) })) }
  }
  for (const k of Object.keys(minim)) if (minim[k] === undefined) delete minim[k]
  return minim
}

// beforeSend / beforeSendTransaction
export function scrubSentryEvent(event) {
  try { return redacteazaAdanc(event) }
  catch { return evenimentMinim(event) }
}
