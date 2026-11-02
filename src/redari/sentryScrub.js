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
// Jakarinos r36 P1-02: escape-urile Unicode (`\u0025` = `%`) se reconstruiesc INAINTE de orice judecata pe chei/valori
// Jakarinos r40/r41 P1-01: decodor COMPLET de escape-uri JavaScript — `\uXXXX`, `\u{H..}`, `\xHH`, octal `\125`, escape de identitate `\U` -> `U`
// (si `\n`,`\t`... -> caracterul de control). Orice backslash poate rupe secventa de 43 si poate fi reconstruit de un motor JS — deci TOATE se reconstruiesc.
const CONTROL = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }
// Jakarinos r42: (1) continuarea de linie `\` + CR/LF/CRLF/U+2028/U+2029 dispare complet (ca in JS); (2) octal: `[0-3]` ia pana la 3 cifre,
// `[4-7]` pana la 2 (`\600` = `\60` + `0`), exact ca motorul JS
const cuUnicode = (s) => s.replace(/\\(?:\r\n|[\n\r\u2028\u2029])|\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\([0-3][0-7]{0,2}|[4-7][0-7]?)|\\([^])/g, (_m, a, b, c, o, i) => {
  try {
    if (a || b || c) return String.fromCodePoint(parseInt(a || b || c, 16))
    if (o !== undefined) return String.fromCharCode(parseInt(o, 8))
    if (i === undefined) return ''   // continuare de linie
    return i in CONTROL ? CONTROL[i] : i
  } catch { return _m }
})
const cheieDeToken = (cheie) => typeof cheie === 'string' && [cheie, cuUnicode(cheie)].some(c => formele(c).some(f => /token/i.test(f)))
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
// Jakarinos r23 P1-1: delimitatorul șirului contează — un apostrof poate sta ÎN interiorul unui șir cu ghilimele duble (și invers);
// cheia se închide cu delimitatorul ei (`"…"` sau `'…'`), valoarea-șir la fel
// Jakarinos r24 P1-1: cheia poate fi și FĂRĂ ghilimele (`{ token: 'prefix <T>' }`, stil JS) — continuarea cheii = caractere de identificator
// Jakarinos r25 P1-1 (backtick, comentarii `/* */` între cheie și valoare…): gata cu enumerarea sintaxelor — regula CONSERVATOARE:
// într-un conținut pe care nu-l putem parcurge structural, un cuvânt-cheie (p_token/raspuns/token) urmat în cel mult 200 de caractere
// de ORICE fel (delimitatori, comentarii, spații, escape-uri) de o secvență de ≥43 [A-Za-z0-9_-] e indiciu. Valorile legitime scurte
// (`tokenuri_cumparate: 12`) rămân curate: nu au secvența de 43 după ele.
// Jakarinos r26 P1-1: fără limită de distanță — conținut TEXT neparcurs care pomenește un cuvânt-cheie ȘI conține undeva o secvență
// de ≥43 e indiciu (orice prag de distanță doar mută problema). Se aplică DOAR textului neparcurs structural (dinJson / corp-șir),
// nu serializării unui obiect valid — câmpurile vecine ale unui obiect (`{tokenuri_cumparate: 12, hash}`) sunt parcurse structural (r26 P2-1).
// DECIZIE (r27, după Copilot r21 P1-01 vs r20 P2-01): un token de 43 poate fi, teoretic, pur hexazecimal, iar un SHA-256 în base64url are
// exact 43 de caractere — în text neparcurs cele două sunt INDISTINCTE. Alegem securitatea: orice secvență ≥43 după un cuvânt-cheie e
// indiciu (hex inclus). Costul acceptat: un eveniment al modulului care pune un hash lângă cuvântul token/raspuns într-un TEXT neparcurs
// se pierde. Obiectele structurate nu au această problemă (câmpurile vecine sunt separate), iar modulul raportează erorile structurat.
// Jakarinos r28 P2-1: regula e GLOBALĂ (beforeSend e unul singur) — deci costul atinge și alte module: un eveniment al cărui TEXT neparcurs
// pune cuvântul token/raspuns lângă o secvență de ≥43 (ex. `tokenuri_cumparate=12, hash=<43>` într-un message) se pierde oriunde în ERP.
// Decizie asumată (scoping-ul la /redari ar lăsa o gaură: un text cu token fără marcaj de modul ar trece); de confirmat de Răzvan.
// Jakarinos r33 P2-1: un escape `\uXXXX` SINGUR (`Caracter primit: \u0041`) nu mai e indiciu; indiciul se judeca pe forma cu escape-urile
// reconstruite (`"to\u006ben":[null,T]` -> `"token":[null,T]`), cu aceeasi regula: cuvant-cheie + secventa >=43, sau `p_token` urmat de `=`/`:`
const indiciuPe = (f) => /p_token\W{0,3}[=:]/i.test(f) || (/p_token|raspuns|token/i.test(f) && RX_RUN43.test(f))
const RX_INDICIU_JSON = { test: (f) => indiciuPe(f) || indiciuPe(cuUnicode(f)) }

// Decodează ORICE secvență %XX validă (litere, cifre, separatoare), o dată; secvențele invalide rămân.
const decodeazaOdata = (s) => {
  try { return decodeURIComponent(s) }
  catch { return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => { try { return decodeURIComponent(m) } catch { return m } }) }
}
// [brut, dec1, dec2, dec3] — până la MAX_DECODARI sau până nu se mai schimbă
// Jakarinos r38 P1-01: transformarile pot ALTERNA (`\u00255Cu0055` -> `%5Cu0055` -> `\u0055` -> `U`) — formele se construiesc
// aplicand pe rand reconstruirea escape-urilor Unicode si decodarea procentuala, pana la stabilizare sau pana la limita de pasi
const MAX_PASI = 8
const RX_INCA_CODIFICAT = /%[0-9A-Fa-f]{2}|\\[^]/   // orice %XX sau orice escape cu backslash (r41: inclusiv octal si identitate)
const RX_INCA_CODIFICAT_G = new RegExp(RX_INCA_CODIFICAT.source, 'g')
export const formele = (s) => {
  const lista = [s]
  let curent = s
  for (let i = 0; i < MAX_PASI; i++) {
    if (!RX_INCA_CODIFICAT.test(curent)) break
    const u = cuUnicode(curent)
    const d = decodeazaOdata(u)
    if (d === curent) break
    if (u !== curent && u !== d) lista.push(u)
    lista.push(d); curent = d
  }
  return lista
}
// a atins limita de pasi si INCA mai are %XX / \uXXXX = nu stim ce ascunde
const aAtinsLimita = (s) => { let c = s, i = 0; for (; i < MAX_PASI; i++) { if (!RX_INCA_CODIFICAT.test(c)) return false; const u = cuUnicode(c); const d = decodeazaOdata(u); if (d === c) return false; c = d }; return RX_INCA_CODIFICAT.test(c) }
// Jakarinos r28 P1-1: un șir care, după MAX_DECODARI decodări, ÎNCĂ mai conține `%XX` (codificat de ≥4 ori, ex. `%25252574oken`) e
// AMBIGUU — nu putem ști ce cheie ascunde; evenimentul devine purtător (orice secvență ≥43 rămasă ⇒ null). Creșterea limitei ar muta pragul.
const ramaneCodificat = (s) => typeof s === 'string' && aAtinsLimita(s)
// Jakarinos r36 P2-01: `token_endpoint: '/oauth/%25252520'` (scurt) NU poate ascunde un identificator de 43 — semnal TARE doar daca forma ramasa
// are >=43 de grupuri %XX sau >=129 de caractere (un identificator codificat caracter cu caracter are cel putin 43 x 3)
// Jakarinos r37 P1-01: identificatorul poate fi codificat DOAR PARȚIAL (un singur caracter `%25252555` între caractere clare) — lungimea
// potențială = caractere clare + câte un caracter pentru fiecare grup `%XX` rămas; dacă poate ajunge la 43 ⇒ poate ascunde identificatorul
// Jakarinos r38 P2-01: lungimea potentiala se masoara pe CEA MAI LUNGA secventa [A-Za-z0-9_-] (cu %XX / \uXXXX numarate ca un caracter),
// nu pe tot textul — un URL legitim lung cu separatori (`/oauth/provider/.../%25252520`) nu poate ascunde un identificator de 43
const poateAscundeToken = (s) => ramaneCodificat(s) && (() => { const f = formele(s); const u = f[f.length - 1].replace(RX_INCA_CODIFICAT_G, 'x'); return RX_RUN43.test(u) })()
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
  // Jakarinos r33 P1-1: JSON valid `{"token":"<T cu un \u0055 in mijloc>"}` — tokenul e colectat structural, dar in SIR sta sub escape;
  // daca forma cu escape-urile reconstruite (si cu backslash-urile dublate reduse) contine un token colectat, tot sirul devine [token]
  if (tokenuri.size && s.includes('\\u')) {
    for (const f of forme) for (const g of [cuUnicode(f), cuUnicode(f.replace(/\\\\/g, '\\'))]) if (contineVreunToken(g, tokenuri)) return TOKEN
  }
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
const cheieSensibila = (cheie) => typeof cheie === 'string' && [cheie, cuUnicode(cheie)].some(c => formele(c).some(f => /token|raspuns/i.test(f)))
// numără TOATE cheile dintr-o structură parsată (toate adâncimile, iterativ; JSON.parse nu produce cicluri) — pentru detectarea duplicatelor
const numaraChei = (radacina) => {
  let n = 0
  const stiva = [radacina]
  while (stiva.length) {
    const o = stiva.pop()
    if (!o || typeof o !== 'object') continue
    if (Array.isArray(o)) { for (const v of o) if (v && typeof v === 'object') stiva.push(v); continue }
    for (const k of Object.keys(o)) { n++; const v = o[k]; if (v && typeof v === 'object') stiva.push(v) }
  }
  return n
}
// Copilot FE r5 P1-01: un obiect referit de două ori (o dată sub cheie obișnuită, o dată sub p_token) se parcurge DIN NOU când e atins
// pe calea sensibilă — vizitatele țin nivelul (false → true), deci fiecare obiect e parcurs cel mult de două ori (ciclurile se termină).
// Jakarinos r44 P1-01: toate FRUNZELE-sir ale unui subarbore, in ordinea parcurgerii, unite (fragmente in obiecte/liste imbricate)
// r47 (Copilot r40 P1-02): `saraIndici` — fragmentele de 1-2 caractere pot fi chiar bucati din identificator; se verifica AMBELE variante
const RX_T43_ORIUNDE_G = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g
const frunzeUnite = (radacina, cuChei = false, saraIndici = true, sep = '') => {
  const vaz = new WeakSet(); const stiva = [radacina]; const out = []
  while (stiva.length) {
    const o = stiva.pop()
    if (typeof o === 'number' && Number.isFinite(o)) { const t = String(o); if (!saraIndici || !(t.length <= 2 || /^\d{1,3}$/.test(t))) out.push(t); continue }   // r45 P1-02: fragmentele numerice participa (indicii mici nu)
    if (typeof o === 'string') { if (!saraIndici || !(o.length <= 2 || /^\d{1,3}$/.test(o))) { const f = formele(o); out.push(cuUnicode(f[f.length - 1])) }; continue }   // r49 (Jak r48 P1-04): frunza in forma DECODATA   // r45 P1-01: indicii-sir scurti nu intrerup
    if (!o || typeof o !== 'object' || vaz.has(o)) continue
    vaz.add(o)
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) stiva.push(o[i]); continue }
    const chei = Object.keys(o)
    for (let i = chei.length - 1; i >= 0; i--) { stiva.push(o[chei[i]]); if (cuChei) stiva.push(chei[i]) }
  }
  return out.join(sep)
}
// r48: textele scheletului (dupa allow-list) — secventele de >=12 unite formeaza un identificator?
const texteScheletFormeazaIdentificator = (sk) => {
  const texte = [sk.message, sk.transaction, sk.request?.url]
  for (const x of (sk.exception?.values || [])) { texte.push(x?.type, x?.value) }
  const tot = texte.filter(t => typeof t === 'string').join(' ')
  for (const f of [tot, cuUnicode(tot), ...formele(tot)]) {
    // r49 (Jak r48 P2-01): doar secventele care ARATA a bucata de identificator aleator (litere SI cifre); identificatorii de cod (camelCase, doar litere) nu
    const unit = (f.match(/[A-Za-z0-9_-]{12,}/g) || []).join('')
    if (RX_RUN43.test(unit) && /[A-Za-z]/.test(unit) && /[0-9]/.test(unit)) return true   // conditia litere+cifre pe TEXTUL UNIT (o bucata poate fi doar litere)
  }
  return false
}
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
      // Jakarinos r43: sub context sensibil, o LISTĂ de fragmente (`token: [T[0:20], T[20:]]`) se judecă și unită — identificatorul se colectează
      // (reunirea listelor se face la radacina subarborelui sensibil, in ramura de obiect — r47)
      continue
    }
    for (const cheie of Object.keys(obj)) {
      const v = obj[cheie]
      const cheieNoua = fnCheie ? fnCheie(cheie, sensibil) : cheie   // Jakarinos r15 P1-1: si cheile primesc contextul sensibil
      if (cheieNoua !== cheie) delete obj[cheie]
      let vNou = v
      const sensibilCopil = sensibil || cheieSensibila(cheie) || ramaneCodificat(cheie)   // r36 P1-01: cheie necunoscuta (inca codificata) = context sensibil
      if (v && typeof v === 'object') {
        stiva.push([v, sensibilCopil])
        // Jakarinos r44 P1-01: `token: { a: T[0:20], b: T[20:] }` / `token: [[..],[..]]` — subarborele sensibil se judeca si cu frunzele unite
        // r48 (Jak r47 P1-03): in uniune se cauta o secventa de EXACT 43 delimitata (`prefix ` + T), nu uniunea intreaga; cuvintele legitime unite
        // (47 fara delimitare la 43) tot nu inventeaza candidati (r45 P2-01)
        if (sensibilCopil && !sensibil) { for (const unit of [frunzeUnite(v), frunzeUnite(v, false, false), frunzeUnite(v, false, true, ' '), frunzeUnite(v, false, false, ' ')]) { const m = unit.match(RX_T43_ORIUNDE_G); if (m) for (const t of m) fn(obj, cheie, t, true) } }
      }
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
      if (sub.ambiguu) tokenuri.ambiguu = true   // Jakarinos r34 P1-1: și semnalul slab se propagă din JSON-ul parsat
      // Jakarinos r29 P1-1: CHEI DUPLICATE — JSON.parse păstrează doar ultima valoare (`{"token":{"value":T},"token":null}`), deci
      // structura pierde valoarea sensibilă, dar textul o are. Dacă textul are mai multe chei sensibile decât structura ⇒ duplicate ⇒
      // tratăm textul conservator (secvență ≥43 prezentă ⇒ refuzat)
      // Jakarinos r30 P1-1: numele din text pot avea escape-uri (`"token"`) — nu mai comparăm chei SENSIBILE, ci TOATE cheile:
      // text > structură ⇔ există duplicate undeva (indiferent de nume) ⇒ conservator
      const cheiText = [...json.matchAll(/"(?:[^"\\]|\\.)*"\s*:/g)].length
      // Jakarinos r31 P1-1: fără condiția „secvență de 43 în text” — un `v` în mijlocul tokenului o rupe; duplicatele ⇒ refuzat necondiționat
      if (cheiText > numaraChei(obj)) tokenuri.refuzat = true
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
      // Copilot r28 P1-01: o valoare inca codificata (de >=4 ori) sub CHEIE SENSIBILA sau intr-un sir care pomeneste un cuvant-cheie e semnal
      // TARE (refuzat): un identificator codificat caracter cu caracter nu are nicio secventa de 43 in nicio forma; in rest, semnal slab
      // Jakarinos r39 P1-01: continut INCA codificat dupa limita de pasi, care poate ascunde 43 de caractere, e semnal TARE indiferent de
      // context — cuvantul-cheie insusi poate fi inca ascuns sub codificare (JSON codificat de 9+ ori); nu stim ce ascunde, deci nu trimitem
      if (ramaneCodificat(v)) { if (poateAscundeToken(v)) tokenuri.refuzat = true; else tokenuri.ambiguu = true }
      const vU = cuUnicode(v)
      if (sensibilAici || cheieDeToken(cheie)) { tokenuriDinValoareSensibila(v, tokenuri); if (vU !== v) tokenuriDinValoareSensibila(vU, tokenuri) }
      dinText(v, true, sensibilAici || cheieDeToken(cheie)); if (vU !== v) dinText(vU, true, sensibilAici || cheieDeToken(cheie))
    }
    return v
  }, (cheie, sensibilAici) => { if (ramaneCodificat(cheie)) { if (poateAscundeToken(cheie)) tokenuri.refuzat = true; else tokenuri.ambiguu = true }; if (sensibilAici) tokenuriDinValoareSensibila(cheie, tokenuri); dinText(cheie, true, sensibilAici); return cheie }, sensibil)
  dinText(serializeaza(event), false)   // serializarea întregului eveniment NU se re-parsează (ar fi recursie infinită; structura e deja parcursă)
  return tokenuri
}

// (2b) înlocuire globală în toate șirurile și cheile; valorile de 43 ale cheilor cu „token” în nume → [token]. Mută în loc.
export function redacteazaAdanc(radacina, tokenuriGlobale = null) {
  if (radacina === null || typeof radacina !== 'object') return typeof radacina === 'string' ? redacteazaText(radacina, tokenuriGlobale) : radacina
  return parcurge(radacina,
    (_obj, cheie, v, sensibil) => {
      if (typeof v !== 'string') return v
      if ((sensibil || cheieDeToken(cheie)) && (areRun43(v) || areRun43(cuUnicode(v)) || poateAscundeToken(v))) return TOKEN   // r15/r36: secventa >=43 (si sub escape) sau codificare care poate ascunde un token, sub cheie sensibila -> toata valoarea
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
  // r32: pe lângă formele %-decodate, și forma cu escape-urile JSON `\uXXXX` reconstruite (un identificator poate sta doar sub ele)
  const formeToate = formele(text)
  // Jakarinos r33 P1-1: JSON.stringify dubleaza backslash-ul (`\\u0055`) — reducem `\\` -> `\` inainte de reconstruire
  for (const f of [...formeToate]) for (const u of [cuUnicode(f), cuUnicode(f.replace(/\\\\/g, '\\'))]) if (u !== f) formeToate.push(u)
  // Jakarinos r34: și ordinea inversă — escape-urile Unicode pot ascunde un `%` (`%`), deci reconstruim ÎNTÂI, apoi decodăm procentual
  for (const u of [cuUnicode(text), cuUnicode(text.replace(/\\\\/g, '\\'))]) if (u !== text) for (const f of formele(u)) if (!formeToate.includes(f)) formeToate.push(f)
  // Jakarinos r43 P1-01: copia unui identificator CUNOSCUT poate fi fragmentată (listă de bucăți, câmpuri separate) — pe fiecare formă și pe
  // forma cu separatorii JSON scoși (unește fragmentele vecine) căutăm orice FEREASTRĂ de 6 caractere consecutive din identificator;
  // 64^6 ≈ 6,9e10 face coincidența cu un șir legitim practic nulă; fragmente sub 6 nu sunt reconstruibile fără identificator (rezidual asumat)
  // Jakarinos r44 P2-01: fara ferestre de 6 (coincidente cu date legitime, ex. `id: '012345'`); in schimb (r44 P1-02) identificatorul INTREG
  // se cauta in toate FRUNZELE-sir unite in ordinea parcurgerii (fragmente ordonate de orice marime, cu chei/indici intre ele), in
  // cheile unite, si in formele cu separatorii JSON scosi
  // ...si FERESTRE de 12 caractere (nu 6: `id: '012345'` e o coincidenta plauzibila; 12 caractere dintr-un identificator aleator — 64^12 ≈ 4,7e21 —
  // nu apar legitim in alt camp): prind bucatile mari (span_id = H[0:16], trace_id = H[11:], `copy ` + H[0:20]) chiar si suprapuse/neordonate.
  // Rezidual asumat: bucati sub 12 caractere in ordine amestecata.
  const ferestre = []
  if (tokenuri.size) {
    for (const t of tokenuri) for (let i = 0; i + 12 <= t.length; i++) ferestre.push(t.slice(i, i + 12))
    for (const u of [frunzeUnite(event), frunzeUnite(event, true), frunzeUnite(event, false, false), frunzeUnite(event, true, false)]) for (const g of [u, cuUnicode(u), ...formele(u)]) if (contineVreunToken(g, tokenuri) || ferestre.some(w => g.includes(w))) return true
  }
  // formele „unite” (fără separatori) se folosesc DOAR pentru identificatorii cunoscuți (întregi sau ferestre) — nu pentru regex-urile
  // generice de 43, care pe un text lipit ar aprinde fals (șiruri scurte legitime puse cap la cap)
  if (tokenuri.size) for (const f of [...formeToate]) {
    const u = f.replace(/["'\s,\[\]{}:]+/g, '')
    if (u !== f && (contineVreunToken(u, tokenuri) || ferestre.some(w => u.includes(w)))) return true
  }
  for (const f of formeToate) {
    if (contineVreunToken(f, tokenuri)) return true
    if (ferestre.length && ferestre.some(w => f.includes(w))) return true
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
    let esteBucata = () => false
    const golit = () => {
      for (const k of Object.keys(span)) if (!['span_id', 'trace_id', 'parent_span_id', 'start_timestamp', 'timestamp'].includes(k)) delete span[k]
      for (const k of ['span_id', 'trace_id', 'parent_span_id']) delete span[k]   // r45 P1-03: id-urile pot fi bucati din identificator — un span golit nu le pastreaza
      for (const k of ['start_timestamp', 'timestamp']) if (k in span && typeof span[k] !== 'number') delete span[k]
      span.op = 'redactat'; span.description = '[redactat]'; span.data = {}
      return span
    }
    if (esteDinFormularulPublic({ transaction: span.description, request: { url: span.data?.['sentry.transaction'] ?? span.data?.url } })) return golit()
    const tokenuri = colecteazaTokenuriEveniment(span)
    // Jakarinos r44 P1-03: un id hex care e BUCATA dintr-un identificator colectat (span_id = H[0:16], trace_id = H[11:]) nu se pastreaza
    esteBucata = (id) => { for (const t of tokenuri) if (t.includes(id)) return true; return false }
    redacteazaAdanc(span, tokenuri)
    if (tokenuri.refuzat) return golit()   // r32 P1-1: refuzat ⇒ golit necondiționat
    if (maiScurgeToken(span, tokenuri, tokenuri.size > 0 || !!tokenuri.ambiguu)) return golit()
    return span
  } catch {
    try {
      const idScurt = (v) => (typeof v === 'string' && /^[0-9a-f]{1,32}$/i.test(v) ? v : undefined)
      const nr = (v) => (typeof v === 'number' ? v : undefined)
      return { start_timestamp: nr(span?.start_timestamp), timestamp: nr(span?.timestamp), op: 'redactat', description: '[redactat]', data: {} }   // r45 P1-03: fara id-uri
    } catch { return { op: 'redactat', description: '[redactat]', data: {} } }
  }
}

// beforeSend / beforeSendTransaction
// Controlul PRINCIPAL pentru evenimentele modulului (r46): un eveniment produs in contextul Redari (pagina /redari, cerere spre rpc/fn_red_*,
// tranzactie/breadcrumb cu /redari) pastreaza DOAR campurile fara date de utilizator: tip/valoare/stack ale exceptiei (fara `vars`),
// message, level, transaction, release/environment, timestamp, event_id, platform, sdk, tags fara valori lungi, request.url/method.
// `extra`, `contexts`, `breadcrumbs`, `request.data/body/headers/cookies/query_string`, `user` dispar. Asa, clasa intreaga de
// „identificator ascuns in extra sub orice forma" nu mai exista pentru evenimentele modulului; euristicile de mai jos raman aparare in
// adancime pentru restul ERP-ului (unde un identificator al modulului nu are cum sa apara decat prin defect).
const RX_CONTEXT_REDARI = /\/redari(?![a-z])|rpc\/fn_red_/i
export function esteDinContextRedari(event) {
  if (typeof window !== 'undefined' && RX_CONTEXT_REDARI.test(String(window.location?.pathname || ''))) return true
  const e = event || {}
  if (vreoFormaSePotriveste(e.request?.url, RX_CONTEXT_REDARI) || vreoFormaSePotriveste(e.transaction, RX_CONTEXT_REDARI)) return true
  const bc = Array.isArray(e.breadcrumbs) ? e.breadcrumbs : (Array.isArray(e.breadcrumbs?.values) ? e.breadcrumbs.values : [])
  for (const b of bc) { if (!b || typeof b !== 'object') continue; for (const u of [b.url, b.data?.url, b.data?.to, b.data?.from, b.message]) if (vreoFormaSePotriveste(u, RX_CONTEXT_REDARI)) return true }   // r47: si b.message
  return false
}
// r47 (Jakarinos r46 P1-02): si formele decodate (`%55` in mijloc, escape-uri JS) si continutul inca codificat
const sirScurt = (v, n = 200) => typeof v === 'string' && v.length <= n && !formele(v).some(f => RX_RUN43.test(f) || RX_RUN43.test(cuUnicode(f))) && !ramaneCodificat(v)
export function doarCampurileSigure(event) {
  const e = event
  const out = {}
  // r48 (Jak r47 P1-01): fara `tags` (cheile pot purta fragmente), fara logger/server_name/dist — scheletul e minim
  // r49 (Jak r48 P1-01): fara `release`/`sdk` (pot purta fragmente); `environment` doar din lista cunoscuta; `platform`/`level`/`type` doar valori cunoscute
  for (const k of ['event_id', 'timestamp', 'start_timestamp']) if (k in e && (typeof e[k] === 'number' || (sirScurt(e[k], 40) && /^[0-9a-f-]+$/i.test(e[k])))) out[k] = e[k]
  if (['production', 'development', 'preview', 'test'].includes(e.environment)) out.environment = e.environment
  if (['javascript', 'node'].includes(e.platform)) out.platform = e.platform
  if (['fatal', 'error', 'warning', 'log', 'info', 'debug'].includes(e.level)) out.level = e.level
  if (['error', 'transaction', 'default'].includes(e.type)) out.type = e.type
  if (sirScurt(e.message, 2000)) out.message = e.message
  if (sirScurt(e.transaction, 500)) out.transaction = e.transaction
  if (e.request && typeof e.request === 'object') { out.request = {}; if (sirScurt(e.request.url, 2000)) out.request.url = e.request.url; if (sirScurt(e.request.method, 10)) out.request.method = e.request.method }
  const vals = e.exception?.values
  if (Array.isArray(vals)) out.exception = { values: vals.filter(x => x && typeof x === 'object').map(x => ({
    type: sirScurt(x.type, 200) ? x.type : undefined, value: sirScurt(x.value, 2000) ? x.value : undefined, mechanism: x.mechanism && typeof x.mechanism === 'object' ? { type: sirScurt(x.mechanism.type) ? x.mechanism.type : undefined, handled: typeof x.mechanism.handled === 'boolean' ? x.mechanism.handled : undefined } : undefined,
    stacktrace: Array.isArray(x.stacktrace?.frames) ? { frames: x.stacktrace.frames.filter(f => f && typeof f === 'object').map(f => ({ filename: sirScurt(f.filename, 500) ? f.filename : undefined, function: sirScurt(f.function, 300) ? f.function : undefined, lineno: typeof f.lineno === 'number' ? f.lineno : undefined, colno: typeof f.colno === 'number' ? f.colno : undefined, in_app: typeof f.in_app === 'boolean' ? f.in_app : undefined })) } : undefined,
  })) }
  return out
}
export function scrubSentryEvent(event) {
  try {
    if (event === null || typeof event !== 'object') return null
    if (esteDinFormularulPublic(event)) return null
    let tokOrig = null
    if (esteDinContextRedari(event)) {
      // r46: controlul principal — doar campurile sigure; apoi aceleasi verificari ca pentru orice eveniment (aparare in adancime)
      tokOrig = colecteazaTokenuriEveniment(event)   // r47 (Jak r46 P1-01): identificatorii din ORIGINALUL complet, inainte de filtrare
      event = doarCampurileSigure(event)
      // r47 (Copilot r40 P1-01): fragmente FARA sursa, raspandite intre campurile permise (message + exception.value) — frunzele scheletului
      // unite in ordine nu au voie sa formeze o secventa de >=43 (scheletul are putine campuri, toate scurte; concatenarea lor nu e un caz legitim)
      // r48 (Jak r47 P1-02 / P2-01): se unesc DOAR textele scheletului (message, transaction, exception.type/value, request.url) si din ele
      // doar secventele de >=12 [A-Za-z0-9_-] (etichetele scurte dintre fragmente — `prima: `, `ultima: ` — nu intrerup); id-urile hex,
      // timestamp-ul, platform NU participa (Jak r47 P2-01). O secventa de 43 formata asa => evenimentul nu se trimite.
      if (texteScheletFormeazaIdentificator(event)) return null
    }
    const tokenuri = colecteazaTokenuriEveniment(event)   // ÎNAINTE de ștergerea corpului — colectează și din request.data/body
    if (tokOrig) { for (const t of tokOrig) tokenuri.add(t); if (tokOrig.refuzat) tokenuri.refuzat = true; if (tokOrig.ambiguu) tokenuri.ambiguu = true }
    // r14 P1-1 (Jakarinos + Copilot r8): `refuzat` (JSON suspect neparcurs, oriunde in eveniment, nu doar in corp) face evenimentul purtator
    let purtator = tokenuri.size > 0 || !!tokenuri.refuzat || !!tokenuri.ambiguu
    const req = event.request
    if (req && typeof req === 'object' && (req.data !== undefined || req.body !== undefined)) {
      const corp = serializeaza({ data: req.data, body: req.body })
      const urlRpc = vreoFormaSePotriveste(typeof req.url === 'string' ? req.url : '', /rpc\/fn_red_/i)
      // r9 P2-2 / r11 P2-1: corpul se ȘTERGE dacă URL-ul e un RPC al modulului, dacă poartă un token colectat sau dacă are indiciu
      // (p_token/raspuns în vreo formă decodată); evenimentul devine „purtător” (orice secvență ≥43 rămasă ⇒ null) DOAR când
      // corpul șters avea indiciu de token — nu pentru simplul URL RPC fără corp sau cu corp curat (altfel un hash SHA-256
      // legitim ar pierde erori reale ale modulului)
      // r21: același indiciu cu sintaxă de cheie ca la JSON-ul neparcurs (un corp `{msg:'raspuns salvat'}` nu face evenimentul purtător)
      // r26 P2-1: indiciul textual se aplică doar corpurilor-ȘIR (neparcurse structural); un obiect `data` valid a fost deja parcurs
      // structural (cheile de token colectate), iar câmpurile lui vecine nu se amestecă; cheia `p_token` prezentă rămâne indiciu
      // Jakarinos r27 P2-1: un corp-șir care SE PARSEAZĂ ca JSON a fost deja parcurs structural (dinJson) — indiciul textual nu i se
      // mai aplică (altfel câmpurile vecine s-ar amesteca din nou); rămâne pentru textul care NU se parsează
      const seParseaza = (s) => formele(s).some(f => { try { const o = JSON.parse(f); return !!o && typeof o === 'object' } catch { return false } })
      const siruri = [req.data, req.body].filter(v => typeof v === 'string' && !seParseaza(v))
      const indiciu = siruri.some(s => formele(s).some(f => RX_INDICIU_JSON.test(f) || RX_INDICIU_JSON.test(f.replace(/\\(["\\/])/g, '$1'))))
        || formele(corp).some(f => /p_token[^A-Za-z0-9_]{0,4}[:=]/i.test(f))   // cheia p_token (și în corp-șir serializat: `\"p_token\":`)
      const pomeneste = formele(corp).some(f => /p_token|raspuns/i.test(f))
      if (urlRpc || contineVreunToken(corp, tokenuri) || indiciu || pomeneste) { delete req.data; delete req.body }
      if (indiciu || tokenuri.refuzat) purtator = true
    }
    redacteazaAdanc(event, tokenuri)
    // Jakarinos r32 P1-1: `refuzat` (conținut suspect pe care NU l-am putut parcurge/redacta sigur: duplicate, codificări peste limită,
    // JSON neparcurs cu indiciu) ⇒ evenimentul se elimină NECONDIȚIONAT — nu mai depinde de găsirea unei copii în clar (identificatorul
    // poate sta doar sub escape-uri Unicode în textul păstrat)
    if (tokenuri.refuzat) return null
    if (maiScurgeToken(event, tokenuri, purtator)) return null
    return event
  } catch {
    return null
  }
}
