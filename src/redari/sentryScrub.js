// Redări teren — redactarea tokenului public (/redari/raspuns/<token>) din evenimentele Sentry (review Jakarinos P1-4 / P2-3 / r3 P1-2, P2-7).
// Modul pur (fără React, fără Sentry): se folosește ca beforeSend / beforeSendTransaction în src/main.jsx și se testează cu vitest.
//
// Ce se redactează, în orice șir din eveniment (valori ȘI chei de obiect), la orice adâncime (parcurgere iterativă, cu set de vizitate):
//  1. `/redari/raspuns/<orice>`                      → `/redari/raspuns/[token]`
//  2. `%2Fredari%2Fraspuns%2F<orice>` (URL-encoded)   → `%2Fredari%2Fraspuns%2F[token]`
//  3. orice șir de EXACT 43 caractere [A-Za-z0-9_-] (formatul tokenului) după `raspuns/` sau `raspuns%2F`, sau după `p_token` cu până la
//     16 „separatoare” între ele (orice caracter non-token sau secvență %XX — ex. `%22%3A%22` din JSON URL-encoded) → `[token]`
//  4. Se construiesc formele [brut, dec1, dec2, dec3] (decodare repetată, max 3); tokenurile găsite în ORICARE formă se înlocuiesc
//     global în forma brută (literal + variante %-codificate); dacă vreo formă a rezultatului mai conține un tipar → tot șirul „[redactat]”.
// Dacă parcurgerea aruncă (getter care aruncă, structuri exotice), NU se întoarce evenimentul brut: se întoarce o variantă minimă, fără
// request / breadcrumbs / spans / contexts / extra; dacă nici aceea nu se poate construi → `null` (evenimentul e eliminat, nu trimis brut).

const TOKEN = '[token]'
const REDACTAT = '[redactat]'
const RX_CALE = /\/redari\/raspuns\/([^\s/?#"'&]+)/g
const RX_CALE_ENC = /%2Fredari%2Fraspuns%2F([^\s/?#"'&%]+)/gi
// `raspuns/` sau `raspuns%2F`, apoi tokenul de 43; `p_token`, până la 16 separatoare (non-token sau %XX), apoi tokenul de 43
const RX_TOKEN_RASPUNS = /(raspuns(?:\/|%2F))([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
const RX_TOKEN_P_TOKEN = /(p_token(?:%[0-9A-Fa-f]{2}|[^A-Za-z0-9_-]){0,16})([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/gi
// orice coadă de cale „/redari/raspuns/…” care NU e deja marcajul
const RX_CALE_NEREDACTATA = /\/redari\/raspuns\/(?!\[token\])[^\s/?#"'&]+/i
const MAX_DECODARI = 3
const MIN_LUNGIME_COADA = 16   // cozile de cale mai scurte nu se înlocuiesc global (ar atinge text nevinovat); rămân pe seama regulilor de cale

const pareSuspect = (s) => /redari|raspuns|p_token/i.test(s)

// Decodează procent-codificarea o dată; la eșec (secvență invalidă) decodează doar secvențele %XX valide, ca să nu rămână tokenul ascuns.
const decodeazaOdata = (s) => {
  try { return decodeURIComponent(s) }
  catch { return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => { try { return decodeURIComponent(m) } catch { return m } }) }
}
// [brut, dec1, dec2, dec3] — până la MAX_DECODARI sau până nu se mai schimbă
const formele = (s) => {
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
// tokenurile găsite într-o formă: coada căii /redari/raspuns/… (literal sau %2F), tokenul de 43 după raspuns/ sau p_token
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
const maiContineTipar = (s, tokenuri) => {
  for (const f of formele(s)) {
    for (const t of tokenuri) if (f.includes(t)) return true
    RX_TOKEN_RASPUNS.lastIndex = 0; RX_TOKEN_P_TOKEN.lastIndex = 0
    if (RX_TOKEN_RASPUNS.test(f) || RX_TOKEN_P_TOKEN.test(f) || RX_CALE_NEREDACTATA.test(f)) return true
  }
  return false
}

// Strategia (Jakarinos r4 P1-1): se construiesc formele [brut, dec1, dec2, dec3]; dacă ORICARE conține un tipar, tokenurile găsite în
// toate formele se înlocuiesc GLOBAL în forma brută (encodeURIComponent(token) e identic pentru [A-Za-z0-9_-], deci replaceAll ajunge;
// pentru cozi cu alte caractere se înlocuiesc și variantele codificate o dată / de două ori), apoi se aplică și regulile de cale.
// Dacă după toate astea vreo formă a rezultatului tot mai conține un token / tipar → tot șirul devine „[redactat]”.
const varianteToken = (t) => new Set([t, encodeURIComponent(t), encodeURIComponent(encodeURIComponent(t))])

// `tokenuriGlobale` (opțional) = tokenurile colectate din tot evenimentul (prima trecere): se înlocuiesc în orice șir, chiar fără context.
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
  // verificarea finală rulează mereu: un tipar vizibil doar într-o formă decodată (ex. coadă scurtă sub codificare dublă) → tot șirul
  return maiContineTipar(rezultat, tokenuri) ? REDACTAT : rezultat
}

// Parcurgere iterativă generică (fără recursivitate, fără limită de adâncime), cu set de vizitate pentru cicluri.
// fn(obj, cheie, valoare) e apelat pentru fiecare pereche; întoarce valoarea nouă (sau aceeași). Cheile-șir trec prin fnCheie.
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

const RX_T43 = /^[A-Za-z0-9_-]{43}$/
const cheieDeToken = (cheie) => typeof cheie === 'string' && /token/i.test(cheie)

// Trecerea 1 (P1-1 r5): toate tokenurile candidate din întreg evenimentul — valoarea de 43 a oricărei chei cu „token” în nume
// (p_token, token_raspuns, extra.token…), plus tokenurile după raspuns/ sau p_token din orice șir (toate formele decodate) și din chei.
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

// Trecerea 2: înlocuiește global fiecare token colectat (literal + codificat simplu/dublu) în toate șirurile și cheile; valorile de 43 ale
// cheilor cu „token” în nume devin „[token]” indiferent de conținut. Mută în loc.
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

// serializare sigură la cicluri / getter-e, pentru verificarea finală
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

// beforeSend / beforeSendTransaction (Jakarinos r5 P1-1), pe evenimentul STRUCTURAT:
//  (1) colectare globală a tokenurilor; (2) înlocuire globală în toate șirurile și cheile; (3) request.data / request.body eliminate complet
//  dacă conțin vreun token sau dacă URL-ul cererii conține `rpc/fn_red_`; (4) verificare finală pe evenimentul serializat: dacă mai apare
//  vreun token → null (eveniment eliminat). La excepție: eveniment minim → altfel null. Niciodată evenimentul brut.
export function scrubSentryEvent(event) {
  try {
    if (event === null || typeof event !== 'object') return event
    const tokenuri = colecteazaTokenuriEveniment(event)
    // (3) înainte de înlocuire: corpul cererii nu se păstrează dacă poartă token sau e un RPC al modulului
    const req = event.request
    if (req && typeof req === 'object') {
      const url = typeof req.url === 'string' ? req.url : ''
      const corp = serializeaza({ data: req.data, body: req.body })
      const urlRpc = /rpc\/fn_red_/i.test(url) || formele(url).some(f => /rpc\/fn_red_/i.test(f))
      if (urlRpc || contineVreunToken(corp, tokenuri) || /p_token|raspuns/i.test(corp)) { delete req.data; delete req.body }
    }
    redacteazaAdanc(event, tokenuri)
    // (4) verificarea finală pe tot evenimentul
    if (tokenuri.size && contineVreunToken(serializeaza(event), tokenuri)) return null
    return event
  } catch {
    try { return evenimentMinim(event) }
    catch { return null }
  }
}
