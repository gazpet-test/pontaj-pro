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
// r8 P1-1 (Jakarinos): cheie SERIALIZATĂ cu „token” sau „raspuns” în nume (ex. `"token_raspuns_public":"<43>"` într-un corp JSON),
// cu sufix de cheie și până la 16 separatoare (sau %XX) — tokenul de 43 se colectează și se înlocuiește
const RX_TOKEN_CHEIE = /((?:token|raspuns)[A-Za-z0-9_-]{0,32}?(?:%[0-9A-Fa-f]{2}|[^A-Za-z0-9_-]){1,16})([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
const RX_T43 = /^[A-Za-z0-9_-]{43}$/
const RX_T43_ORIUNDE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/
// r10 P1-1 (Jakarinos): într-un eveniment „purtător de token” orice secvență de ≥43 (tokenul lipit de un prefix/sufix, ex. `ref_<T>`) e suspectă
const RX_T43_PLUS = /[A-Za-z0-9_-]{43,}/
const RX_DROP = /\/redari\/raspuns|rpc\/fn_red_formular_public|rpc\/fn_red_raspuns_public/i
// r7 P1-2: cuvântul-cheie poate avea sufix (token_raspuns_public), apoi până la 16 separatoare, apoi tokenul de 43
const RX_FINAL = /(raspuns|token)[A-Za-z0-9_-]{0,32}?[^A-Za-z0-9_-]{0,16}[A-Za-z0-9_-]{43}/i
const RX_RASPUNS_PUBLIC = /\/redari\/raspuns/i
const MAX_DECODARI = 3
const MIN_LUNGIME_COADA = 16

const pareSuspect = (s) => /redari|raspuns|token/i.test(s)
// r11 P1-1 (Jakarinos): cheile se judecă pe TOATE formele decodate (`%70%5f%74%6f%6b%65%6e` = p_token)
const cheieDeToken = (cheie) => typeof cheie === 'string' && formele(cheie).some(f => /token/i.test(f))
// r7 P1-2: valoarea unei chei de token e token dacă ORICE formă decodată are exact 43 [A-Za-z0-9_-] (ex. `%30` + 42 caractere)
const valoareDeToken = (v) => typeof v === 'string' && formele(v).some(f => RX_T43.test(f))
// Jakarinos r15 P1-2 / Copilot r9 P1-01: sub o cheie sensibila valoarea poate fi `'   ' + T` sau `'ref_' + T` - orice secventa de >=43
// [A-Za-z0-9_-] din orice forma decodata conteaza: exact 43 -> token; 44..300 -> toate ferestrele de 43 (tokenul lipit); mai lung -> refuzat
// ATENȚIE: `.test` cu flag `g` lasă `lastIndex` nenul, iar `matchAll` îl CLONEAZĂ — un regex global partajat între cele două a
// pierdut colectarea (bug găsit în r19 la a doua rulare pe același modul). Deci: regex fără `g` pentru test, `g` doar pentru matchAll.
const RX_RUN43 = /[A-Za-z0-9_-]{43,}/
const RX_RUN43_TOATE = /[A-Za-z0-9_-]{43,}/g
const areRun43 = (v) => typeof v === 'string' && formele(v).some(f => RX_RUN43.test(f))
const tokenuriDinValoareSensibila = (v, set) => {
  if (typeof v !== 'string') return
  for (const f of formele(v)) for (const m of f.matchAll(RX_RUN43_TOATE)) {
    const run = m[0]
    if (run.length === 43) set.add(run)
    else if (run.length <= 300) for (let i = 0; i + 43 <= run.length; i++) set.add(run.slice(i, i + 43))
    else set.refuzat = true
  }
}
// Jakarinos r16 P2-1: o cheie *token* cu valoare-șir e indiciu doar dacă șirul (chiar netrunchiat) conține o secvență de ≥43 — `"tokenuri_cumparate":"12"` nu e
// Jakarinos r17 P1-1: în valoarea-șir se sar și secvențele escape (`\"`, `\\`), altfel `"prefix \"<T` ascundea tokenul după ghilimeaua escapată
// Jakarinos r18 P1-1: cheia e ORICE șir JSON care conține „token” (`token.value`, `token value`…), aliniat cu `cheieSensibila` — nu doar [A-Za-z0-9_-]
// Jakarinos r21 P2-1: simpla apariție a cuvântului „raspuns” („Eroare la salvare raspuns”) NU e indiciu — se cere sintaxă de cheie
// (`"p_token":` / `p_token=`, sau `"…token…"`/`"…raspuns…"` urmată de `:` și valoare listă/obiect/șir cu secvență ≥43) sau escape `\uXXXX`
// Jakarinos r22 P1-1: pseudo-JSON cu APOSTROFURI (`{'p_token':'prefix <T>'}`) — cheile și valorile sensibile se recunosc cu `"` sau `'`
const RX_INDICIU_JSON = /\\u[0-9a-f]{4}|p_token['"]?\s*[=:]|(?:raspuns|token)(?:[^"'\\]|\\.)*['"]\s*:\s*(?:[\[{]|['"](?:[^"'\\]|\\.)*[A-Za-z0-9_-]{43})/i

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
  for (const rx of [RX_CALE, RX_CALE_ENC, RX_TOKEN_RASPUNS, RX_TOKEN_P_TOKEN, RX_TOKEN_CHEIE]) {
    rx.lastIndex = 0
    for (const m of forma.matchAll(rx)) { const t = m[m.length - 1]; if (t && t !== TOKEN && t.length >= MIN_LUNGIME_COADA) set.add(t) }
  }
}
const aplicaRegulileDeCale = (s) => s
  .replace(RX_CALE_ENC, `%2Fredari%2Fraspuns%2F${TOKEN}`)
  .replace(RX_CALE, `/redari/raspuns/${TOKEN}`)
  .replace(RX_TOKEN_RASPUNS, (_, prefix) => `${prefix}${TOKEN}`)
  .replace(RX_TOKEN_P_TOKEN, (_, prefix) => `${prefix}${TOKEN}`)
  .replace(RX_TOKEN_CHEIE, (_, prefix) => `${prefix}${TOKEN}`)
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
// r10 P1-1 (Jakarinos): `sensibil` = un STRĂMOȘ e o cheie de token (p_token, token*, raspuns*) — descendenții ei (liste `[null, T]`,
// obiecte `{ value: T }`) se tratează ca valori de token, structural, nu prin regex pe serializare.
const cheieSensibila = (cheie) => typeof cheie === 'string' && formele(cheie).some(f => /token|raspuns/i.test(f))
// Copilot FE r5 P1-01: un obiect referit de două ori (o dată sub cheie obișnuită, o dată sub p_token) se parcurge DIN NOU când e atins
// pe calea sensibilă — vizitatele țin nivelul (false → true), deci fiecare obiect e parcurs cel mult de două ori (ciclurile se termină).
function parcurge(radacina, fn, fnCheie = null, sensibilInitial = false) {
  if (radacina === null || typeof radacina !== 'object') return radacina
  const vizitate = new WeakMap()   // obj → sensibil cu care a fost parcurs
  const stiva = [[radacina, sensibilInitial]]
  while (stiva.length) {
    const [obj, sensibil] = stiva.pop()
    if (obj === null || typeof obj !== 'object') continue
    if (vizitate.has(obj) && (vizitate.get(obj) || !sensibil)) continue
    vizitate.set(obj, sensibil)
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const v = obj[i]
        if (v && typeof v === 'object') stiva.push([v, sensibil])
        else { const n = fn(obj, null, v, sensibil); if (n !== v) obj[i] = n }
      }
      continue
    }
    for (const cheie of Object.keys(obj)) {
      const v = obj[cheie]
      const cheieNoua = fnCheie ? fnCheie(cheie, sensibil) : cheie   // Jakarinos r15 P1-1: si cheile primesc contextul sensibil
      if (cheieNoua !== cheie) delete obj[cheie]
      let vNou = v
      const sensibilCopil = sensibil || cheieSensibila(cheie)
      if (v && typeof v === 'object') stiva.push([v, sensibilCopil])
      else vNou = fn(obj, cheie, v, sensibilCopil)
      if (cheieNoua !== cheie || vNou !== v) obj[cheieNoua] = vNou
    }
  }
  return radacina
}

// (2a) tokenurile candidate din întreg evenimentul
// Jakarinos r14 P1-2: `sensibil` = structura asta e descendenta unei chei de token (si JSON-ul parsat dintr-o valoare-sir mosteneste contextul)
export function colecteazaTokenuriEveniment(event, adancime = 0, sensibil = false) {
  const tokenuri = new Set()
  // r9 P1-1 (Jakarinos): indiciul se caută în TOATE formele decodate (o cheie complet %-codificată, ex. `%70%5f%74%6f%6b%65%6e`,
  // nu arată „suspect” brut), iar colectarea se face și pe evenimentul SERIALIZAT întreg — așa prindem și valorile din liste
  // (`p_token: [T]`) sau cheile/valorile despărțite de structură, care la parcurgerea șir-cu-șir n-au context
  // r12 P1-1 (Jakarinos): un șir care e JSON (corp de cerere serializat, `{"token":[null,T]}`, `{"token":{"nested":{"value":T}}}`)
  // se parsează (în fiecare formă decodată) și se parcurge STRUCTURAL, ca orice obiect — cheile de token își protejează descendenții
  // Copilot FE r7 P2-01: un JSON pe care NU-l putem parcurge (prea mare, prea adânc, invalid) dar care pomenește token/raspuns
  // marchează setul ca `refuzat` → evenimentul devine „purtător” (orice secvență ≥43 rămasă ⇒ null) — nu ne bazăm pe limite
  const dinJson = (f, sensibilSir = false) => {
    // Jakarinos r19 P1-1: JSON-ul poate sta ÎN MIJLOCUL unui șir (`payload={"token.value":"…"}`) — indiciul se caută pe tot șirul, iar
    // parsarea se încearcă de la primul `{`/`[` (ce e înainte nu poate ascunde o cheie)
    // Jakarinos r20 P1-1: un FRAGMENT de JSON fără `{`/`[` (`"token.value":"prefix <T>"}`) e tot indiciu — indiciul textual se
    // testează ÎNAINTE de orice ieșire, pe șirul brut și pe forma cu escape-urile JSON scoase
    const indiciuText = RX_INDICIU_JSON.test(f) || RX_INDICIU_JSON.test(f.replace(/\\(["\\/])/g, '$1'))
    const start = f.search(/[[{]/)
    if (start < 0) { if (indiciuText) tokenuri.refuzat = true; return }
    if (start > 0 && indiciuText) tokenuri.refuzat = true
    const json = start > 0 ? f.slice(start) : f
    // Jakarinos r13 P1-1: cheia poate fi scrisă cu escape Unicode (`"to\u006ben"`) — un JSON neparcurs cu escape-uri e și el suspect
    // Jakarinos r15 P2-1: `"tokenuri_cumparate":12` intr-un JSON trunchiat NU e indiciu; e indiciu o cheie *token* cu valoare sir/lista/obiect
    // r19: JSON-ul poate fi un literal-șir JSON (`"{\"token.value\":\"…\"}"`) — indiciul se testează și pe forma cu escape-urile JSON scoase
    const refuza = () => { if (sensibilSir || indiciuText) tokenuri.refuzat = true }
    if (adancime >= 4 || json.length > 200000) return refuza()   // adâncime limitată: JSON în JSON în JSON…
    let obj
    try { obj = JSON.parse(json) } catch { return refuza() }
    if (obj && typeof obj === 'object') {
      const sub = colecteazaTokenuriEveniment(obj, adancime + 1, sensibilSir)
      for (const t of sub) tokenuri.add(t)
      if (sub.refuzat) tokenuri.refuzat = true
    }
  }
  // Jakarinos r13 P1-1: parsarea JSON NU depinde de indiciul textual (cheia `token` poate fi `"to\u006ben"` în text) — orice șir
  // care începe cu `{`/`[`, în oricare formă decodată, se parsează și se parcurge structural
  const dinText = (s, siJson = true, sensibilSir = false) => {
    if (typeof s !== 'string') return
    const forme = formele(s)
    if (forme.some(pareSuspect)) for (const f of forme) colecteazaTokenuri(f, tokenuri)
    if (siJson) for (const f of forme) dinJson(f, sensibilSir)
  }
  parcurge(event, (_obj, cheie, v, sensibilAici) => {
    if (typeof v === 'string') {
      if (sensibilAici || cheieDeToken(cheie)) tokenuriDinValoareSensibila(v, tokenuri)
      dinText(v, true, sensibilAici || cheieDeToken(cheie))
    }
    return v
  }, (cheie, sensibilAici) => { if (sensibilAici) tokenuriDinValoareSensibila(cheie, tokenuri); dinText(cheie, true, sensibilAici); return cheie }, sensibil)
  dinText(serializeaza(event), false)   // serializarea întregului eveniment NU se re-parsează (ar fi recursie infinită; structura e deja parcursă)
  return tokenuri
}

// (2b) înlocuire globală în toate șirurile și cheile; valorile de 43 ale cheilor cu „token” în nume → [token]. Mută în loc.
export function redacteazaAdanc(radacina, tokenuriGlobale = null) {
  if (radacina === null || typeof radacina !== 'object') return typeof radacina === 'string' ? redacteazaText(radacina, tokenuriGlobale) : radacina
  return parcurge(radacina,
    (_obj, cheie, v, sensibil) => {
      if (typeof v !== 'string') return v
      if ((sensibil || cheieDeToken(cheie)) && areRun43(v)) return TOKEN   // r15: orice secventa >=43 sub cheie sensibila -> toata valoarea
      return redacteazaText(v, tokenuriGlobale)
    },
    (cheie, sensibil) => (sensibil && areRun43(cheie) ? TOKEN : redacteazaText(cheie, tokenuriGlobale)))
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
// `aPurtatToken` = evenimentul a avut tokenuri colectate SAU un corp de cerere suspect (șters fără să-l putem redacta sigur)
export function maiScurgeToken(event, tokenuri, aPurtatToken = tokenuri.size > 0) {
  const text = serializeaza(event)
  for (const f of formele(text)) {
    if (contineVreunToken(f, tokenuri)) return true
    if (RX_FINAL.test(f) || RX_RASPUNS_PUBLIC.test(f)) return true
    if (aPurtatToken && RX_T43_PLUS.test(f)) return true   // a purtat token: orice secvență de ≥43 rămasă (și lipită de prefix) e suspectă
    if (RX_T43_ORIUNDE.test(f) && tokenuri.size) return true
  }
  return false
}

// r7 P1-1: spanurile de sine stătătoare (INP din browserTracingIntegration) NU trec prin beforeSend/beforeSendTransaction, iar
// beforeSendSpan nu poate elimina un span (null e ignorat în SDK ≥ 9). Deci: (a) INP e OPRIT în src/main.jsx (enableInp: false),
// (b) tracesSampler dă 0 pe formularul public, (c) beforeSendSpan redactează oricum, iar dacă rămâne ceva suspect golește spanul.
export function scrubSentrySpan(span) {
  try {
    if (span === null || typeof span !== 'object') return span
    // Jakarinos r16 P1-1: `op`/`origin` NU se păstrează (pot purta tokenul); id-urile/timpii rămân doar dacă sunt id-uri hex scurte / numere
    const idScurt = (v) => typeof v === 'string' && /^[0-9a-f]{1,32}$/i.test(v)
    const golit = () => {
      for (const k of Object.keys(span)) if (!['span_id', 'trace_id', 'parent_span_id', 'start_timestamp', 'timestamp'].includes(k)) delete span[k]
      for (const k of ['span_id', 'trace_id', 'parent_span_id']) if (k in span && !idScurt(span[k])) delete span[k]
      for (const k of ['start_timestamp', 'timestamp']) if (k in span && typeof span[k] !== 'number') delete span[k]
      span.op = 'redactat'; span.description = '[redactat]'; span.data = {}
      return span
    }
    if (esteDinFormularulPublic({ transaction: span.description, request: { url: span.data?.['sentry.transaction'] ?? span.data?.url } })) return golit()
    const tokenuri = colecteazaTokenuriEveniment(span)
    redacteazaAdanc(span, tokenuri)
    if (maiScurgeToken(span, tokenuri, tokenuri.size > 0 || !!tokenuri.refuzat)) return golit()   // r14 P1-1: si spanurile tin cont de `refuzat`
    return span
  } catch {
    try {
      const idScurt = (v) => (typeof v === 'string' && /^[0-9a-f]{1,32}$/i.test(v) ? v : undefined)
      const nr = (v) => (typeof v === 'number' ? v : undefined)
      return { span_id: idScurt(span?.span_id), trace_id: idScurt(span?.trace_id), start_timestamp: nr(span?.start_timestamp), timestamp: nr(span?.timestamp), op: 'redactat', description: '[redactat]', data: {} }
    } catch { return { op: 'redactat', description: '[redactat]', data: {} } }
  }
}

// beforeSend / beforeSendTransaction
export function scrubSentryEvent(event) {
  try {
    if (event === null || typeof event !== 'object') return null
    if (esteDinFormularulPublic(event)) return null
    const tokenuri = colecteazaTokenuriEveniment(event)   // ÎNAINTE de ștergerea corpului — colectează și din request.data/body
    // r14 P1-1 (Jakarinos + Copilot r8): `refuzat` (JSON suspect neparcurs, oriunde in eveniment, nu doar in corp) face evenimentul purtator
    let purtator = tokenuri.size > 0 || !!tokenuri.refuzat
    const req = event.request
    if (req && typeof req === 'object' && (req.data !== undefined || req.body !== undefined)) {
      const corp = serializeaza({ data: req.data, body: req.body })
      const urlRpc = vreoFormaSePotriveste(typeof req.url === 'string' ? req.url : '', /rpc\/fn_red_/i)
      // r9 P2-2 / r11 P2-1: corpul se ȘTERGE dacă URL-ul e un RPC al modulului, dacă poartă un token colectat sau dacă are indiciu
      // (p_token/raspuns în vreo formă decodată); evenimentul devine „purtător” (orice secvență ≥43 rămasă ⇒ null) DOAR când
      // corpul șters avea indiciu de token — nu pentru simplul URL RPC fără corp sau cu corp curat (altfel un hash SHA-256
      // legitim ar pierde erori reale ale modulului)
      // r21: același indiciu cu sintaxă de cheie ca la JSON-ul neparcurs (un corp `{msg:'raspuns salvat'}` nu face evenimentul purtător)
      const indiciu = formele(corp).some(f => RX_INDICIU_JSON.test(f) || RX_INDICIU_JSON.test(f.replace(/\\(["\\/])/g, '$1')))
      const pomeneste = formele(corp).some(f => /p_token|raspuns/i.test(f))
      if (urlRpc || contineVreunToken(corp, tokenuri) || indiciu || pomeneste) { delete req.data; delete req.body }
      if (indiciu || tokenuri.refuzat) purtator = true
    }
    redacteazaAdanc(event, tokenuri)
    if (maiScurgeToken(event, tokenuri, purtator)) return null
    return event
  } catch {
    return null
  }
}
