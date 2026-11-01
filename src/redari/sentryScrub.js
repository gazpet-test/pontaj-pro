// Redări teren — redactarea tokenului public (/redari/raspuns/<token>) din evenimentele Sentry (review Jakarinos P1-4 / P2-3 / r3 P1-2, P2-7).
// Modul pur (fără React, fără Sentry): se folosește ca beforeSend / beforeSendTransaction în src/main.jsx și se testează cu vitest.
//
// Ce se redactează, în orice șir din eveniment (valori ȘI chei de obiect), la orice adâncime (parcurgere iterativă, cu set de vizitate):
//  1. `/redari/raspuns/<orice>`                      → `/redari/raspuns/[token]`
//  2. `%2Fredari%2Fraspuns%2F<orice>` (URL-encoded)   → `%2Fredari%2Fraspuns%2F[token]`
//  3. orice șir de EXACT 43 caractere [A-Za-z0-9_-] (formatul tokenului) după `raspuns/` sau `raspuns%2F`, sau după `p_token` cu până la
//     16 „separatoare” între ele (orice caracter non-token sau secvență %XX — ex. `%22%3A%22` din JSON URL-encoded) → `[token]`
//  4. Înainte de scanare, șirul se DECODEAZĂ repetat (până la 3 iterații sau până nu se mai schimbă) pe o copie: dacă forma brută nu
//     se potrivește, dar una decodată da, se întoarce forma decodată redactată (tokenul dispare; forma textului se poate schimba).
// Dacă parcurgerea aruncă (getter care aruncă, structuri exotice), NU se întoarce evenimentul brut: se întoarce o variantă minimă, fără
// request / breadcrumbs / spans / contexts / extra; dacă nici aceea nu se poate construi → `null` (evenimentul e eliminat, nu trimis brut).

const TOKEN = '[token]'
const RX_CALE = /\/redari\/raspuns\/[^\s/?#"'&]+/g
const RX_CALE_ENC = /%2Fredari%2Fraspuns%2F[^\s/?#"'&%]+/gi
// `raspuns/` sau `raspuns%2F`, apoi tokenul de 43; `p_token`, până la 16 separatoare (non-token sau %XX), apoi tokenul de 43
const RX_TOKEN_RASPUNS = /(raspuns(?:\/|%2F))([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
const RX_TOKEN_P_TOKEN = /(p_token(?:%[0-9A-Fa-f]{2}|[^A-Za-z0-9_-]){0,16})([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/g
const MAX_DECODARI = 3

const pareSuspect = (s) => /redari|raspuns|p_token/i.test(s)

const aplicaReguli = (s) => s
  .replace(RX_CALE_ENC, `%2Fredari%2Fraspuns%2F${TOKEN}`)
  .replace(RX_CALE, `/redari/raspuns/${TOKEN}`)
  .replace(RX_TOKEN_RASPUNS, (_, prefix) => `${prefix}${TOKEN}`)
  .replace(RX_TOKEN_P_TOKEN, (_, prefix) => `${prefix}${TOKEN}`)

// Decodează procent-codificarea o dată; la eșec (secvență invalidă) decodează doar secvențele %XX valide, ca să nu rămână tokenul ascuns.
const decodeazaOdata = (s) => {
  try { return decodeURIComponent(s) }
  catch { return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => { try { return decodeURIComponent(m) } catch { return m } }) }
}

export function redacteazaText(s) {
  if (typeof s !== 'string' || !pareSuspect(s)) return s
  // 1. forma brută
  const brut = aplicaReguli(s)
  if (brut !== s) return brut
  // 2. formele decodate (pe copie), până la MAX_DECODARI sau până nu se mai schimbă
  let curent = s
  for (let i = 0; i < MAX_DECODARI; i++) {
    if (!curent.includes('%')) break
    const decodat = decodeazaOdata(curent)
    if (decodat === curent) break
    const redactat = aplicaReguli(decodat)
    if (redactat !== decodat) return redactat
    curent = decodat
  }
  return s
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
// Poate arunca ea însăși (getter pe timestamp etc.) — apelantul o protejează și întoarce null.
export function evenimentMinim(event) {
  const e = (event && typeof event === 'object') ? event : {}
  const sigur = (v) => (typeof v === 'string' ? redacteazaText(v) : undefined)
  const minim = {
    event_id: typeof e.event_id === 'string' ? e.event_id : undefined,
    timestamp: (typeof e.timestamp === 'number' || typeof e.timestamp === 'string') ? e.timestamp : undefined,
    platform: typeof e.platform === 'string' ? e.platform : undefined,
    level: typeof e.level === 'string' ? e.level : undefined,
    environment: typeof e.environment === 'string' ? e.environment : undefined,
    release: typeof e.release === 'string' ? e.release : undefined,
    transaction: sigur(e.transaction),
    message: sigur(typeof e.message === 'string' ? e.message : e.message?.formatted),
    tags: { sentry_scrub: 'minim' },
  }
  // excepția: doar tipul + mesajul (redactate), fără stack cu URL-uri
  const valori = e.exception?.values
  if (Array.isArray(valori)) {
    minim.exception = { values: valori.slice(0, 5).map(x => ({ type: sigur(x?.type), value: sigur(x?.value) })) }
  }
  for (const k of Object.keys(minim)) if (minim[k] === undefined) delete minim[k]
  return minim
}

// beforeSend / beforeSendTransaction: eveniment redactat → altfel eveniment minim → altfel null (eliminat, niciodată brut)
export function scrubSentryEvent(event) {
  try { return redacteazaAdanc(event) }
  catch {
    try { return evenimentMinim(event) }
    catch { return null }
  }
}
