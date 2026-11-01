// Redări teren — teste pentru redactarea tokenului public din evenimentele Sentry (src/redari/sentryScrub.js). Tokenuri fictive.
import { describe, it, expect } from 'vitest'
import { redacteazaText, redacteazaAdanc, scrubSentryEvent, scrubSentrySpan, esteDinFormularulPublic } from './sentryScrub.js'

const T43 = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE'   // 43 caractere [A-Za-z0-9_-]
const T42 = T43.slice(0, 42)

describe('redacteazaText', () => {
  it('redactează calea /redari/raspuns/<token> în URL-uri și transaction', () => {
    expect(redacteazaText(`https://erp.example/redari/raspuns/${T43}?x=1`)).toBe('https://erp.example/redari/raspuns/[token]?x=1')
    expect(redacteazaText('/redari/raspuns/abc-scurt')).toBe('/redari/raspuns/[token]')
  })
  it('redactează varianta URL-encoded (%2F), inclusiv cu litere mici', () => {
    expect(redacteazaText(`https://x/?next=%2Fredari%2Fraspuns%2F${T43}%3Fa%3D1`)).toBe('https://x/?next=%2Fredari%2Fraspuns%2F[token]%3Fa%3D1')
    expect(redacteazaText(`next=%2fredari%2fraspuns%2f${T43}`)).toBe('next=%2Fredari%2Fraspuns%2F[token]')
    expect(redacteazaText(`raspuns%2F${T43}`)).toBe('raspuns%2F[token]')
  })
  it('redactează tokenul de 43 de caractere după raspuns/ sau p_token, indiferent de separatori', () => {
    expect(redacteazaText(`raspuns/${T43}`)).toBe('raspuns/[token]')
    expect(redacteazaText(`{"p_token":"${T43}","p_optiune":"particip"}`)).toBe('{"p_token":"[token]","p_optiune":"particip"}')
    expect(redacteazaText(`p_token=${T43}&x=1`)).toBe('p_token=[token]&x=1')
    expect(redacteazaText(`p_token%22%3A%22${T43}%22`)).toBe('p_token%22%3A%22[token]%22')            // separatoare %XX, formă brută
    expect(redacteazaText(`p_token : '${T43}'`)).toBe("p_token : '[token]'")
  })
  it('redactează după decodarea procent-codificării (JSON URL-encoded, dublu-encoded)', () => {
    const corp = encodeURIComponent(JSON.stringify({ p_token: T43, p_optiune: 'particip' }))
    const rez = redacteazaText(corp)
    expect(rez).not.toContain(T43)
    expect(rez).toContain('[token]')
    const dublu = encodeURIComponent(encodeURIComponent(`/redari/raspuns/${T43}`))
    expect(dublu).not.toContain('/redari/raspuns/')    // nici forma brută, nici prima decodare nu au calea în clar
    const rez2 = redacteazaText(dublu)
    expect(rez2).not.toContain(T43)
    expect(rez2).toContain('[token]')
  })
  it('Jakarinos r4: redactează TOATE aparițiile, inclusiv pe cele dublu-codificate din același șir', () => {
    const s = `/redari/raspuns/${T43} p_token%2522%253A%2522${T43}`
    const rez = redacteazaText(s)
    expect(rez).not.toContain(T43)
    expect(rez).toBe('/redari/raspuns/[token] p_token%2522%253A%2522[token]')
  })
  it('Jakarinos r4: redactează când și „p_token” e procent-codificat', () => {
    const s = `%70%5f%74%6f%6b%65%6e%22%3A%22${T43}`
    const rez = redacteazaText(s)
    expect(rez).not.toContain(T43)
    expect(rez).toBe('%70%5f%74%6f%6b%65%6e%22%3A%22[token]')
  })
  it('forma brută rămâne forma brută (nu se întoarce textul decodat); tokenul dispare din toate formele', () => {
    const corp = encodeURIComponent(JSON.stringify({ p_token: T43 }))
    const rez = redacteazaText(corp)
    expect(rez).toBe(corp.split(T43).join('[token]'))
    expect(decodeURIComponent(rez)).not.toContain(T43)
  })
  it('coadă scurtă ascunsă sub codificare dublă: nu se poate redacta local, dar evenimentul care o poartă se elimină (r6)', () => {
    // coada „abc-scurt” e sub pragul de înlocuire globală, iar calea apare doar după două decodări → verificarea finală pe eveniment ⇒ null
    const s = encodeURIComponent(encodeURIComponent('/redari/raspuns/abc-scurt'))
    expect(scrubSentryEvent({ message: s })).toBeNull()
    expect(scrubSentryEvent({ extra: { nota: s } })).toBeNull()
  })
  it('nu atinge șiruri fără token (42 de caractere, alt context, text obișnuit, % invalid)', () => {
    expect(redacteazaText(`p_token=${T42}`)).toBe(`p_token=${T42}`)
    expect(redacteazaText(`altceva/${T43}`)).toBe(`altceva/${T43}`)
    expect(redacteazaText('TypeError: x is not a function')).toBe('TypeError: x is not a function')
    expect(redacteazaText('raspuns 100% sigur %ZZ')).toBe('raspuns 100% sigur %ZZ')
    expect(redacteazaText(123)).toBe(123)
  })
})

describe('redacteazaAdanc', () => {
  it('redactează valori la orice adâncime (peste 12 niveluri) și în array-uri', () => {
    let ev = { url: `/redari/raspuns/${T43}` }
    for (let i = 0; i < 40; i++) ev = { copil: ev, lista: [`p_token=${T43}`] }
    redacteazaAdanc(ev)
    let cur = ev
    for (let i = 0; i < 40; i++) { expect(cur.lista[0]).toBe('p_token=[token]'); cur = cur.copil }
    expect(cur.url).toBe('/redari/raspuns/[token]')
  })
  it('redactează cheile obiectelor', () => {
    const ev = { breadcrumbs: { [`GET /redari/raspuns/${T43}`]: 1, ok: 'da' } }
    redacteazaAdanc(ev)
    expect(Object.keys(ev.breadcrumbs).sort()).toEqual(['GET /redari/raspuns/[token]', 'ok'])
    expect(ev.breadcrumbs['GET /redari/raspuns/[token]']).toBe(1)
  })
  it('nu intră în buclă la referințe circulare', () => {
    const a = { url: `/redari/raspuns/${T43}` }; a.self = a; a.lista = [a]
    expect(() => redacteazaAdanc(a)).not.toThrow()
    expect(a.url).toBe('/redari/raspuns/[token]')
  })
  it('redactează un eveniment Sentry realist: request.url, transaction, breadcrumbs, spans, contexts', () => {
    const ev = {
      transaction: `/redari/raspuns/${T43}`,
      request: { url: `https://erp/redari/raspuns/${T43}`, headers: { Referer: `https://erp/redari/raspuns/${T43}` } },
      breadcrumbs: [
        { category: 'fetch', data: { url: `https://api/rest/v1/rpc/fn_red_formular_public`, body: `{"p_token":"${T43}"}` } },
        { message: `navigare la /redari/raspuns/${T43}` },
        { data: { query: `?body=${encodeURIComponent(JSON.stringify({ p_token: T43 }))}` } },
      ],
      spans: [{ description: `GET /redari/raspuns/${T43}`, data: { 'http.url': `https://erp/redari/raspuns/${T43}` } }],
      contexts: { trace: { data: { next: `%2Fredari%2Fraspuns%2F${T43}` } } },
      exception: { values: [{ type: 'Error', value: 'ceva' }] },
    }
    // r6: evenimentul vine de pe formularul public (transaction / request.url) → se elimină complet, nu se redactează
    expect(scrubSentryEvent(ev)).toBeNull()
    // redactarea în sine (pentru evenimente interne) rămâne verificată pe șiruri:
    expect(redacteazaText(`{"p_token":"${T43}"}`)).toBe('{"p_token":"[token]"}')
  })
})

describe('scrubSentryEvent pe eveniment structurat (Jakarinos r5)', () => {
  it('cerere către RPC-ul public (fn_red_raspuns_public) → evenimentul se elimină complet (r6 DROP)', () => {
    const ev = { request: { url: 'https://api/rest/v1/rpc/fn_red_raspuns_public', data: { p_token: T43, p_optiune: 'particip' } }, breadcrumbs: [{ message: `trimis ${T43}` }] }
    expect(scrubSentryEvent(ev)).toBeNull()
  })
  it('request.url pe /redari/raspuns/… → eliminat complet (r6 DROP), oricât de bine s-ar redacta restul', () => {
    const ev = { request: { url: '/redari/raspuns/' + T43 }, extra: { token: T43, nota: `vezi ${T43} aici`, [T43]: 1 } }
    expect(scrubSentryEvent(ev)).toBeNull()
  })
  it('eveniment intern cu token în request.data (URL intern): corpul dispare, tokenul e înlocuit global, inclusiv în chei', () => {
    const ev = { request: { url: 'https://api/rest/v1/rpc/fn_altceva', data: { p_token: T43 } }, extra: { nota: `vezi ${T43} aici`, [T43]: 1 }, breadcrumbs: [{ message: `trimis ${T43}` }] }
    const rez = scrubSentryEvent(ev)
    expect(rez).not.toBeNull()
    expect(rez.request.data).toBeUndefined()
    expect(rez.extra.nota).toBe('vezi [token] aici')
    expect(rez.extra['[token]']).toBe(1)
    expect(rez.breadcrumbs[0].message).toBe('trimis [token]')
    expect(JSON.stringify(rez)).not.toContain(T43)
  })
  it('valoarea de 43 a unei chei cu „token” în nume devine [token] chiar fără alt context (token_raspuns)', () => {
    const ev = { contexts: { red: { token_raspuns: T43, altceva: 'x' } } }
    const rez = scrubSentryEvent(ev)
    expect(rez.contexts.red.token_raspuns).toBe('[token]')
    expect(rez.contexts.red.altceva).toBe('x')
  })
  it('cerere către fn_red_formular_public → eliminat (r6 DROP); alt RPC fn_red_* intern → doar corpul dispare', () => {
    expect(scrubSentryEvent({ request: { url: 'https://api/rest/v1/rpc/fn_red_formular_public', body: '{"x":1}', method: 'POST' } })).toBeNull()
    const rez = scrubSentryEvent({ request: { url: 'https://api/rest/v1/rpc/fn_red_numar_document', body: '{"p_tip":"C"}', method: 'POST' } })
    expect(rez.request.body).toBeUndefined()
    expect(rez.request.method).toBe('POST')
  })
  it('nu atinge un eveniment obișnuit', () => {
    const ev = { message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12 } }
    const rez = scrubSentryEvent(ev)
    expect(rez).toEqual({ message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12 } })
  })
})

describe('scrubSentryEvent — r6: DROP pe formularul public, verificare finală pe toate formele, null la orice excepție', () => {
  it('Jakarinos: token în extra + mesaj „%41” + 42×A (copie ascunsă sub codificare) ⇒ null', () => {
    expect(scrubSentryEvent({ extra: { token: T43 }, message: '%41' + 'A'.repeat(42) })).toBeNull()
    expect(scrubSentryEvent({ message: '%41' + 'A'.repeat(42), extra: { token: T43 } })).toBeNull()   // indiferent de ordinea cheilor
  })
  it('Jakarinos: getter care aruncă ⇒ null (fără „eveniment minim” care ar fi păstrat message: T)', () => {
    const ev = { message: T43, extra: { token: T43 } }
    Object.defineProperty(ev, 'broken', { enumerable: true, configurable: true, get() { throw new Error('broken') } })
    expect(scrubSentryEvent(ev)).toBeNull()
    const ev2 = { event_id: 'e2', message: 'x' }
    Object.defineProperty(ev2, 'timestamp', { enumerable: true, configurable: true, get() { throw new Error('timestamp care aruncă') } })
    expect(scrubSentryEvent(ev2)).toBeNull()
  })
  it('evenimentele obișnuite (fără tokenuri) trec neatinse', () => {
    const ev = { message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12, hash: 'a'.repeat(43) }, breadcrumbs: [{ data: { url: 'https://erp/rest/v1/rpc/fn_pontaj' } }] }
    const rez = scrubSentryEvent(ev)
    expect(rez).toEqual({ message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12, hash: 'a'.repeat(43) }, breadcrumbs: [{ data: { url: 'https://erp/rest/v1/rpc/fn_pontaj' } }] })
  })
  it('eveniment intern cu token DOAR în extra.token (fără alte copii) ⇒ redactat, nu null', () => {
    const rez = scrubSentryEvent({ message: 'convocator generat', extra: { token: T43, id_parcela: 'T3-HUS-0001' } })
    expect(rez).not.toBeNull()
    expect(rez.extra.token).toBe('[token]')
    expect(rez.message).toBe('convocator generat')
    expect(JSON.stringify(rez)).not.toContain(T43)
  })
  it('DROP și după breadcrumb-uri (URL brut sau codificat) sau transaction', () => {
    expect(scrubSentryEvent({ message: 'x', breadcrumbs: [{ category: 'navigation', data: { to: `/redari/raspuns/${T43}` } }] })).toBeNull()
    expect(scrubSentryEvent({ message: 'x', breadcrumbs: [{ data: { url: `https://erp/?next=%252Fredari%252Fraspuns%252F${T43}` } }] })).toBeNull()
    expect(scrubSentryEvent({ message: 'x', transaction: '/redari/raspuns/:token' })).toBeNull()
    expect(esteDinFormularulPublic({ request: { url: 'https://api/rest/v1/rpc/fn_red_formular_public' } })).toBe(true)
    expect(esteDinFormularulPublic({ request: { url: 'https://api/rest/v1/rpc/fn_red_numar_document' } })).toBe(false)
  })
  it('DROP după pagina curentă (window.location.pathname pe /redari/raspuns…)', () => {
    const vechi = globalThis.window
    globalThis.window = { location: { pathname: '/redari/raspuns/' + T43 } }
    try { expect(scrubSentryEvent({ message: 'eroare oarecare', extra: { a: 1 } })).toBeNull() }
    finally { if (vechi === undefined) delete globalThis.window; else globalThis.window = vechi }
    expect(scrubSentryEvent({ message: 'eroare oarecare', extra: { a: 1 } })).toEqual({ message: 'eroare oarecare', extra: { a: 1 } })
  })
  it('o copie a tokenului după raspuns/token + separatori nu rămâne (r8: redactată de RX_TOKEN_CHEIE; altfel null din regex-ul final)', () => {
    expect(scrubSentryEvent({ message: `raspuns: ${T43}` })).toEqual({ message: 'raspuns: [token]' })
    expect(scrubSentryEvent({ extra: { nota: `token=${'b'.repeat(43)}` } })).toEqual({ extra: { nota: 'token=[token]' } })
    expect(scrubSentryEvent({ message: `raspuns${T43}` })).toBeNull()   // fără separator: necolectat → regex-ul final ⇒ null
  })
})

describe('scrubSentryEvent / scrubSentrySpan — r7 (Jakarinos): token codificat sub cheie cu sufix, spanuri', () => {
  const T = '0123456789abcdefghijklmnopqrstuvwxyzABCDEF_'   // 43
  it('P1-2: message = T + extra.token_raspuns_public = %30 + T[1:] ⇒ tokenul codificat e colectat din forma decodată; nicio copie nu rămâne', () => {
    for (const ev of [
      { message: T, extra: { token_raspuns_public: '%30' + T.slice(1) } },
      { extra: { token_raspuns_public: '%30' + T.slice(1) }, message: T },        // indiferent de ordinea cheilor
      { message: T, extra: { token_x: '%25%33%30' + T.slice(1) } },               // dublu codificat
      { message: 'x ' + T + ' y', contexts: { formular: { token: '%30' + T.slice(1) } } },
    ]) {
      const rez = scrubSentryEvent(ev)
      if (rez !== null) { const j = JSON.stringify(rez); expect(j).not.toContain(T); expect(j).not.toContain(T.slice(1)); expect(j).toContain('[token]') }
    }
    expect(scrubSentryEvent({ message: T, extra: { token_raspuns_public: '%30' + T.slice(1) } })?.message ?? '[token]').toBe('[token]')
  })
  it('P1-2: cheie cu sufix fără altă copie ⇒ redactat (nu null), valoarea decodată nu rămâne', () => {
    const rez = scrubSentryEvent({ message: 'ok', extra: { token_raspuns_public: '%30' + T.slice(1) } })
    expect(rez).not.toBeNull()
    expect(rez.extra.token_raspuns_public).toBe('[token]')
    expect(JSON.stringify(rez)).not.toContain(T.slice(1))
  })
  it('r8 P1-1 (Jakarinos): token codificat într-un corp de cerere SERIALIZAT + copie în message ⇒ nicio copie nu rămâne', () => {
    const ev = { message: T, request: { url: 'https://example.test/api', data: JSON.stringify({ token_raspuns_public: '%30' + T.slice(1) }) } }
    const rez = scrubSentryEvent(ev)
    if (rez !== null) { const j = JSON.stringify(rez); expect(j).not.toContain(T); expect(j).not.toContain(T.slice(1)) }
    // corp suspect șters + un alt șir de 43 rămas (ex. tokenul sub altă cheie, fără context) ⇒ null
    expect(scrubSentryEvent({ extra: { x: 'z'.repeat(43) }, request: { url: 'https://e/api', body: '{"p_token":"nu-e-43"}' } })).toBeNull()
    const r2 = scrubSentryEvent({ message: T, request: { data: encodeURIComponent(JSON.stringify({ raspuns_token: T })) } })
    expect(r2).toEqual({ message: '[token]', request: {} })
    // cheie serializată cu sufix, în text liber
    expect(redacteazaText(`{"token_raspuns_public":"${T}"}`)).toBe('{"token_raspuns_public":"[token]"}')
    expect(redacteazaText(`tokenul=${T}`)).toBe('tokenul=[token]')
  })
  it('r9 P1-1 (Jakarinos): cheie complet %-codificată în corp + token lipit de prefix în message; valoare-listă sub p_token', () => {
    const r1 = scrubSentryEvent({ message: 'ref_' + T, request: { url: 'https://example.test/api', body: '{"%70%5f%74%6f%6b%65%6e":"' + T + '"}' } })
    expect(r1 === null || !JSON.stringify(r1).includes(T)).toBe(true)
    if (r1) expect(r1.message).toBe('ref_[token]')
    const r2 = scrubSentryEvent({ message: 'ref_' + T, request: { url: 'https://example.test/api', data: { p_token: [T] } } })
    expect(r2 === null || !JSON.stringify(r2).includes(T)).toBe(true)
    const r3 = scrubSentryEvent({ message: T, request: { url: 'https://e/api', body: encodeURIComponent(encodeURIComponent('{"p_token":"' + T + '"}')) } })
    expect(r3 === null || !JSON.stringify(r3).includes(T)).toBe(true)
  })
  it('r10 P1-1 (Jakarinos): descendenții cheilor de token (listă cu null înainte, obiect) + copie lipită de prefix ⇒ nicio copie nu rămâne', () => {
    for (const data of [{ p_token: [null, T] }, { p_token: ['x', T] }, { p_token: { value: T } }, { raspuns: { adanc: { lista: [1, { t: '%30' + T.slice(1) }] } } }]) {
      const rez = scrubSentryEvent({ request: { url: '/intern', data }, message: 'ref_' + T })
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
      expect(rez === null || !JSON.stringify(rez).includes(T.slice(1))).toBe(true)
    }
    // purtător de token (corp suspect șters) + secvență ≥43 lipită de prefix, necolectabilă ⇒ null
    expect(scrubSentryEvent({ request: { url: '/intern', body: '{"p_token":"scurt"}' }, message: 'ref_' + 'q'.repeat(43) })).toBeNull()
  })
  it('Copilot FE r5 P1-01: obiect referit de două ori (sub cheie obișnuită și sub p_token) — contextul sensibil nu se pierde', () => {
    const comun = { value: 'q'.repeat(43) }
    const rez = scrubSentryEvent({ extra: { p_token: comun, alta_referinta: comun } })
    expect(rez === null || !JSON.stringify(rez).includes('q'.repeat(43))).toBe(true)
    const comun2 = { value: 'w'.repeat(43) }
    const rez2 = scrubSentryEvent({ extra: { alta_referinta: comun2, p_token: comun2 } })
    expect(rez2 === null || !JSON.stringify(rez2).includes('w'.repeat(43))).toBe(true)
    // ciclu + referință dublă: se termină și nu scapă nimic
    const c = { value: 'e'.repeat(43) }; c.self = c; c.lista = [c, { adanc: c }]
    const rez3 = scrubSentryEvent({ message: 'x', extra: { a: c, token_ref: { b: c } } })
    const vaz = new WeakSet(); const sigur = JSON.stringify(rez3, (_k, v) => { if (v && typeof v === 'object') { if (vaz.has(v)) return '[ciclu]'; vaz.add(v) } return v })
    expect(rez3 === null || !sigur.includes('e'.repeat(43))).toBe(true)
  })
  it('r11 P1-1 (Jakarinos): cheie %-codificată ca obiect structural (`%70%5f%74%6f%6b%65%6e`: [null, T] / {nested:{value:T}}) + ref_<T>', () => {
    for (const extra of [{ '%70%5f%74%6f%6b%65%6e': [null, T] }, { '%70%5f%74%6f%6b%65%6e': { nested: { value: T } } }, { '%72%61%73%70%75%6e%73': { v: '%30' + T.slice(1) } }]) {
      const rez = scrubSentryEvent({ extra, message: 'ref_' + T })
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
      expect(rez === null || !JSON.stringify(rez).includes(T.slice(1))).toBe(true)
    }
  })
  it('r11 P2-1 (Jakarinos): URL RPC al modulului fără corp + hash SHA-256 legitim ⇒ evenimentul trece', () => {
    const ev = { request: { url: '/rest/v1/rpc/fn_red_numar_document' }, extra: { continut_hash: 'a'.repeat(64) }, message: 'Eroare generare convocator' }
    expect(scrubSentryEvent(ev)).toEqual({ request: { url: '/rest/v1/rpc/fn_red_numar_document' }, extra: { continut_hash: 'a'.repeat(64) }, message: 'Eroare generare convocator' })
    // cu corp curat: corpul se șterge (RPC al modulului), hash-ul rămâne, evenimentul trece
    const ev2 = { request: { url: '/rest/v1/rpc/fn_red_numar_document', data: { p_uat: 3 } }, extra: { continut_hash: 'a'.repeat(64) }, message: 'x' }
    expect(scrubSentryEvent(ev2)).toEqual({ request: { url: '/rest/v1/rpc/fn_red_numar_document' }, extra: { continut_hash: 'a'.repeat(64) }, message: 'x' })
  })
  it('r12 P1-1 (Jakarinos): corp de cerere ca ȘIR JSON cu cheie `token` structurală ([null, T], {nested:{value:T}}) + ref_<T>', () => {
    for (const body of [JSON.stringify({ token: [null, T] }), JSON.stringify({ token: { nested: { value: T } } }), encodeURIComponent(JSON.stringify({ x: 1, raspuns: { lista: ['a', { t: T }] } })), JSON.stringify({ inner: JSON.stringify({ token: [T] }) })]) {
      const rez = scrubSentryEvent({ request: { url: '/rest/v1/rpc/fn_red_numar_document', body }, message: 'ref_' + T })
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
  })
  it('Copilot FE r7 P2-01: corp JSON peste limita parserului (200k) / JSON invalid cu cheie token ⇒ purtător ⇒ null', () => {
    const mare = { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body: JSON.stringify({ token: [null, T], padding: 'x'.repeat(200000) }) } }
    expect(scrubSentryEvent(mare)).toBeNull()
    const invalid = { message: 'ref_' + T, request: { url: '/intern', body: '{"token":[null,"' + T + '"' } }   // JSON trunchiat
    expect(scrubSentryEvent(invalid)).toBeNull()
    // JSON mare FĂRĂ token/raspuns și fără secvențe de 43: trece (corpul se șterge doar dacă URL-ul e RPC al modulului)
    const curat = { message: 'ok', request: { url: '/intern', body: JSON.stringify({ padding: 'x'.repeat(200001) }) } }
    expect(scrubSentryEvent(curat)?.message).toBe('ok')
  })
  it('r13 P1-1/P1-2 (Jakarinos): cheie JSON cu escape Unicode (`"to\u006ben"`); JSON împachetat de 4 ori; padding peste limită', () => {
    const uni = { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body: '{"to\\u006ben":[null,"' + T + '"]}' } }
    expect(uni.request.body.includes('\\u006b')).toBe(true)   // sirul contine chiar backslash-u (nu "token" decodat de JS la parsarea sursei)
    expect(uni.request.body.includes('token')).toBe(false)
    const r1 = scrubSentryEvent(uni); expect(r1 === null || !JSON.stringify(r1).includes(T)).toBe(true)
    const r1b = scrubSentryEvent({ message: 'ref_' + T, request: { url: '/intern', body: '{"to\\u006ben":[null,"' + T + '"], "padding":"' + 'x'.repeat(200000) + '"}' } })
    expect(r1b).toBeNull()   // neparcurs (prea mare) + escape-uri => purtator => null
    const uni2 = { message: 'ref_' + T, request: { url: '/intern', data: { 'p_token': { v: T } } } }   // cheie reală `p_token` (JS o decodează la creare)
    const r2 = scrubSentryEvent(uni2); expect(r2 === null || !JSON.stringify(r2).includes(T)).toBe(true)
    let body = JSON.stringify({ token: { nested: { value: T } } })
    for (let i = 0; i < 4; i++) body = JSON.stringify({ inner: body })
    expect(scrubSentryEvent({ message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } })).toBeNull()
    expect(scrubSentryEvent({ message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body: JSON.stringify({ padding: 'x'.repeat(200000), token: [null, T] }) } })).toBeNull()
  })
  it('r14 P1-1 (Jakarinos + Copilot r8): JSON refuzat in afara corpului (extra, span.data) face evenimentul/spanul purtator', () => {
    expect(scrubSentryEvent({ message: 'ref_' + T, extra: { payload: '{"token":[null,"' + T + '"' } })).toBeNull()
    expect(scrubSentryEvent({ message: 'ref_' + T, extra: { payload: JSON.stringify({ padding: 'x'.repeat(200000), token: [null, T] }) } })).toBeNull()
    const sp = scrubSentrySpan({ span_id: 's', trace_id: 't', description: 'ref_' + T, data: { payload: '{"token":[null,"' + T + '"' } })
    expect(JSON.stringify(sp)).not.toContain(T)
  })
  it('r14 P1-2 (Jakarinos): contextul sensibil trece din cheie in JSON-ul parsat din valoarea-sir', () => {
    const r1 = scrubSentryEvent({ extra: { token: JSON.stringify({ nested: { value: T } }) } })
    expect(r1 === null || !JSON.stringify(r1).includes(T)).toBe(true)
    const r2 = scrubSentryEvent({ message: 'x', contexts: { p_token: JSON.stringify([null, { a: [T] }]) } })
    expect(r2 === null || !JSON.stringify(r2).includes(T)).toBe(true)
    // sub cheie de token, un JSON prea mare/neparcurs e refuzat chiar fara cuvantul token in el
    const r3 = scrubSentryEvent({ message: 'ref_' + T, extra: { token: JSON.stringify({ padding: 'x'.repeat(200000), v: [null, T] }) } })
    expect(r3 === null || !JSON.stringify(r3).includes(T)).toBe(true)   // r19: tokenul e colectat din ferestrele de 43 → redactat (nu neapărat null)
    // regresie r19: regex global partajat (lastIndex) — a doua rulare pe același modul pierdea colectarea; rulăm de 3 ori aceleași cazuri
    for (let i = 0; i < 3; i++) {
      const a = scrubSentryEvent({ extra: { p_token: [null, T] }, message: 'ref_' + T })
      const b = scrubSentryEvent({ message: 'ref_' + T, extra: { p_token: { nested: { value: T } } } })
      expect(a === null || !JSON.stringify(a).includes(T)).toBe(true)
      expect(b === null || !JSON.stringify(b).includes(T)).toBe(true)
    }
  })
  it('r15 P1-1 (Jakarinos): tokenul folosit drept CHEIE sub un obiect sensibil', () => {
    const r1 = scrubSentryEvent({ extra: { token: { nested: { deep: { [T]: true } } } } })
    expect(r1 === null || !JSON.stringify(r1).includes(T)).toBe(true)
    const sp = scrubSentrySpan({ span_id: 's', trace_id: 't', data: { token: { nested: { [T]: 1 } } } })
    expect(JSON.stringify(sp)).not.toContain(T)
  })
  it('r15 P1-2 (Jakarinos) / Copilot r9 P1-01: valoare sensibila cu spatii sau prefix (nu exact 43), si in JSON sub cheie sensibila', () => {
    for (const ev of [
      { extra: { token: ' '.repeat(30) + T } },
      { extra: { token: 'ref_' + T } },
      { extra: { p_token: JSON.stringify({ nested: { value: 'prefix-' + T } }) }, message: 'ref_' + T },
      { message: 'x', extra: { raspuns: [' ', { z: 'a'.repeat(10) + T + 'b'.repeat(10) }] } },
    ]) {
      const rez = scrubSentryEvent(ev)
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
    const sp = scrubSentrySpan({ span_id: 's', trace_id: 't', data: { token: ' '.repeat(30) + T } })
    expect(JSON.stringify(sp)).not.toContain(T)
  })
  it('r15 P2-1 (Jakarinos): JSON trunchiat cu `"tokenuri_cumparate":12` + hash legitim NU se pierde', () => {
    const ev = { message: 'Eroare import', extra: { payload: '{"tokenuri_cumparate":12', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'Eroare import', extra: { payload: '{"tokenuri_cumparate":12', continut_hash: 'a'.repeat(64) } })
    // dar un JSON trunchiat cu cheie token si valoare structurala ramane indiciu
    expect(scrubSentryEvent({ message: 'ref_' + T, extra: { payload: '{"token":[null,"' + T + '"' } })).toBeNull()
  })
  it('r16 P1-1 (Jakarinos): spanul golit nu pastreaza `op`/`origin` (pot purta tokenul); id-urile raman doar daca sunt hex scurte', () => {
    const s1 = scrubSentrySpan({ span_id: 'a1b2', trace_id: 'c3d4', op: 'ref_' + T, origin: 'x' + T, data: { url: '/redari/raspuns/' + T } })
    expect(JSON.stringify(s1)).not.toContain(T); expect(s1.op).toBe('redactat'); expect(s1.span_id).toBe('a1b2'); expect(s1.origin).toBeUndefined()
    const s2 = scrubSentrySpan({ span_id: T, trace_id: 'abc', op: 'ref_' + T, data: { payload: '{"token":[null,"' + T + '"' } })   // refuzat -> golit
    expect(JSON.stringify(s2)).not.toContain(T); expect(s2.span_id).toBeUndefined(); expect(s2.trace_id).toBe('abc')
    const s3 = { span_id: 'a', op: 'ref_' + T }; Object.defineProperty(s3, 'broken', { enumerable: true, get() { throw new Error('x') } })
    expect(JSON.stringify(scrubSentrySpan(s3))).not.toContain(T)
  })
  it('r16 P2-1 (Jakarinos): JSON trunchiat cu `"tokenuri_cumparate":"12"` (valoare-sir scurta) + hash legitim NU se pierde', () => {
    const ev = { message: 'Eroare import', extra: { payload: '{"tokenuri_cumparate":"12"', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'Eroare import', extra: { payload: '{"tokenuri_cumparate":"12"', continut_hash: 'a'.repeat(64) } })
    // dar o valoare-sir trunchiata care contine o secventa de 43 ramane indiciu
    const r = scrubSentryEvent({ message: 'ref_' + T, extra: { payload: '{"token_x":"' + T } })
    expect(r === null || !JSON.stringify(r).includes(T)).toBe(true)
  })
  it('r17 P1-1 (Jakarinos): valoare-sir trunchiata cu ghilimea escapata inaintea tokenului ramane indiciu', () => {
    const body = '{"token_x":"prefix \\"' + T   // in JSON: "prefix \"<T
    expect(body.includes('\\"')).toBe(true)
    for (const ev of [
      { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } },
      { message: 'ref_' + T, extra: { payload: body } },
      { message: 'ref_' + T, extra: { payload: '{"token_x":"a\\\\b\\"c' + T } },
    ]) {
      const rez = scrubSentryEvent(ev)
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
    // valoarea legitima scurta cu ghilimea escapata ramane neatinsa
    const ok = { message: 'x', extra: { payload: '{"tokenuri_cumparate":"1\\"2"', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r18 P1-1 (Jakarinos): cheie JSON cu punct/spatiu/alte caractere (`token.value`) in JSON trunchiat ramane indiciu', () => {
    for (const cheie of ['token.value', 'token value', 'x-token/y', 'tok\u0065n', 'mytoken[0]']) {
      const body = '{"' + cheie + '":"prefix ' + T
      for (const ev of [
        { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // cheie cu ghilimea escapata DUPA „token” (cheia decodata contine „token”)
    const r = scrubSentryEvent({ message: 'ref_' + T, extra: { payload: '{"token\\"x":"' + T } })
    expect(r === null || !JSON.stringify(r).includes(T)).toBe(true)
  })
  it('r19 P1-1 (Jakarinos): JSON in mijlocul unui sir (`payload={...}`, form-encoded) - corp, extra, span, serializat de doua ori', () => {
    const inner = JSON.stringify({ 'token.value': 'prefix ' + T })
    for (const body of ['payload=' + inner, 'a=1&payload=' + encodeURIComponent(inner), 'x: ' + JSON.stringify(inner), 'payload=' + inner.slice(0, -2)]) {
      for (const ev of [
        { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: text cu JSON curat inauntru + hash -> trece
    const ok = { message: 'x', extra: { payload: 'rezultat={"ok":true,"n":12}', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r20 P1-1 (Jakarinos): FRAGMENT de JSON fara { sau [ (`"token.value":"prefix <T>"}`) ramane indiciu', () => {
    for (const body of ['"token.value":"prefix ' + T + '"}', 'token.value":"' + T, '"p_token":"' + T + '"', 'x=1&"tokenul":"' + T]) {
      for (const ev of [
        { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: fragment cu cheie token si valoare scurta + hash -> trece
    const ok = { message: 'x', extra: { payload: '"tokenuri_cumparate":"12"}', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r21 P2-1 (Jakarinos): cuvantul „raspuns” in text liber + hash legitim NU pierde evenimentul/spanul', () => {
    const ev = { message: 'Eroare la salvare raspuns', extra: { sha256: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'Eroare la salvare raspuns', extra: { sha256: 'a'.repeat(64) } })
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', op: 'ui', description: 'salvare raspuns', data: { sha256: 'a'.repeat(64) } })
    expect(sp.description).toBe('salvare raspuns'); expect(sp.data.sha256).toBe('a'.repeat(64))
    // corp de cerere care doar pomeneste „raspuns”: se sterge (prudent), dar evenimentul NU devine purtator
    const ev2 = { message: 'x', request: { url: '/intern', data: { msg: 'raspuns salvat' } }, extra: { sha256: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ev2)).toEqual({ message: 'x', request: { url: '/intern' }, extra: { sha256: 'a'.repeat(64) } })
    // dar `p_token=` / `"p_token":` in corp ramane indiciu (purtator)
    expect(scrubSentryEvent({ message: 'x', request: { url: '/intern', body: 'p_token=scurt&a=1' }, extra: { h: 'z'.repeat(43) } })).toBeNull()
  })
  it('r22 P1-1 (Jakarinos): pseudo-JSON cu apostrofuri (`{\'p_token\':\'prefix <T>\'}`) in corp/extra/span ramane indiciu', () => {
    for (const body of ["{'p_token':'prefix " + T + "'}", "{'token.value': 'x " + T + "'}", "'raspuns_token': ['" + T + "']", "{'tokens':{'a':'" + T]) {
      for (const ev of [
        { request: { url: '/api', body }, extra: { copy: T } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim cu apostrofuri: valoare scurta + hash -> trece
    const ok = { message: 'x', extra: { payload: "{'tokenuri_cumparate': '12'}", continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r23 P1-1 (Jakarinos): apostrof IN interiorul unui sir cu ghilimele duble (si invers) nu rupe indiciul', () => {
    for (const body of ['{"token.value":"prefix \' ' + T, '{"token\'value":"' + T, "{'token.value':'prefix \" " + T, '{"raspuns":"it\'s ' + T + '"}', "{'p_token':'x\"" + T + "'}"]) {
      for (const ev of [
        { request: { url: '/api', body }, extra: { copy: T } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: apostrof in valoare scurta + hash -> trece
    const ok = { message: 'x', extra: { payload: '{"tokenuri_cumparate":"it\'s 12"}', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r24 P1-1 (Jakarinos): cheie FARA ghilimele (stil JS: `{ token: \'prefix <T>\' }`) ramane indiciu', () => {
    for (const body of ['{ token: \'prefix ' + T + '\' }', '{token.value: "' + T + '"}', 'raspuns_token: ["' + T + '"]', '{ p_token: "x" , extra: { token: { v: \'' + T]) {
      for (const ev of [
        { request: { url: '/api', body }, extra: { copy: T } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: cheie fara ghilimele cu valoare scurta + hash -> trece
    const ok = { message: 'x', extra: { payload: '{ tokenuri_cumparate: 12, nume: "abc" }', continut_hash: 'a'.repeat(64) } }
    expect(scrubSentryEvent(ok)?.message).toBe('x')
  })
  it('r25 P1-1 (Jakarinos): backtick, comentarii, orice sintaxa - cuvant-cheie urmat in <=200 caractere de o secventa de 43 e indiciu', () => {
    for (const body of ['{ token: `prefix ' + T + '` }', '{ token: /* public */ "prefix ' + T + '" }', 'token => (' + T + ')', '<raspuns token="' + T + '"/>', 'p_token\n\t=\n' + T, 'TOKEN: ' + '.'.repeat(150) + T]) {
      for (const ev of [
        { request: { url: '/rest/v1/rpc/fn_red_numar_document', body }, extra: { copy: T } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: cuvantul token/raspuns fara secventa de 43 dupa el, in acelasi sir + hash in alt camp -> trece
    for (const payload of ['{ token: `scurt` }', 'raspuns: ok /* 12 */', 'tokenuri_cumparate: 12, nume: "abc"']) {
      const ok = { message: 'x', extra: { payload, continut_hash: 'a'.repeat(64) } }
      expect(scrubSentryEvent(ok)?.message).toBe('x')
    }
  })
  it('r9 P2-2 (Jakarinos): eveniment legitim cu `tokenuri_cumparate` în corp + hash de 43 NU se pierde', () => {
    const ev = { message: 'TypeError: factura indisponibila', request: { url: 'https://example.test/facturi', data: { tokenuri_cumparate: 12 } }, extra: { hash: 'a'.repeat(43) } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'TypeError: factura indisponibila', request: { url: 'https://example.test/facturi', data: { tokenuri_cumparate: 12 } }, extra: { hash: 'a'.repeat(43) } })
  })
  it('P1-2: `token_raspuns_public":"<43>"` în text liber e redactat; regex-ul final prinde varianta fără separator', () => {
    expect(scrubSentryEvent({ message: `{"token_raspuns_public":"${'c'.repeat(43)}"}` })).toEqual({ message: '{"token_raspuns_public":"[token]"}' })
    expect(scrubSentryEvent({ message: `token_raspuns_public${'c'.repeat(43)}` })).toBeNull()
  })
  it('P1-1: spanul de pe formularul public sau cu token e golit (nu null — SDK-ul ignoră null), restul trec', () => {
    const s1 = scrubSentrySpan({ span_id: 's', trace_id: 't', op: 'ui.interaction.click', description: 'body > div', data: { 'sentry.transaction': `/redari/raspuns/${T43}`, 'sentry.op': 'ui.interaction.click' } })
    expect(s1.description).toBe('[redactat]'); expect(s1.data).toEqual({}); expect(JSON.stringify(s1)).not.toContain(T43)
    const s2 = scrubSentrySpan({ span_id: 's', trace_id: 't', description: `click ${T43}`, data: { token: T43 } })
    expect(JSON.stringify(s2)).not.toContain(T43)
    const s3 = scrubSentrySpan({ span_id: 's', trace_id: 't', op: 'http.client', description: 'GET /rest/v1/employees', data: { url: 'https://x/rest/v1/employees' } })
    expect(s3).toEqual({ span_id: 's', trace_id: 't', op: 'http.client', description: 'GET /rest/v1/employees', data: { url: 'https://x/rest/v1/employees' } })
    const s4 = { span_id: 's' }; Object.defineProperty(s4, 'broken', { enumerable: true, get() { throw new Error('x') } })
    expect(scrubSentrySpan(s4).description).toBe('[redactat]')
  })
})
