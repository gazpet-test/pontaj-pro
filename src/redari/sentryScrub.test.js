// Redări teren — teste pentru redactarea tokenului public din evenimentele Sentry (src/redari/sentryScrub.js). Tokenuri fictive.
import { describe, it, expect } from 'vitest'
import { redacteazaText, redacteazaAdanc, scrubSentryEvent, scrubSentrySpan, esteDinFormularulPublic, esteDinContextRedari, doarCampurileSigure } from './sentryScrub.js'

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
    // r32: textul neparcurs cu cuvant-cheie + secventa de 43 e `refuzat` => null (inainte: redactat); ambele sunt sigure
    for (const r of [scrubSentryEvent({ message: `raspuns: ${T43}` }), scrubSentryEvent({ extra: { nota: `token=${'b'.repeat(43)}` } })]) expect(r === null || !JSON.stringify(r).includes(T43)).toBe(true)
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
    expect(r2 === null || !JSON.stringify(r2).includes(T)).toBe(true)   // r32: poate fi null (refuzat) sau redactat
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
    // r46: URL-ul rpc/fn_red_ = context Redari -> allow-list: `extra` dispare, evenimentul (message + url) ramane - NU se pierde
    const ev = { request: { url: '/rest/v1/rpc/fn_red_numar_document' }, extra: { continut_hash: 'a'.repeat(64) }, message: 'Eroare generare convocator' }
    expect(scrubSentryEvent(ev)).toEqual({ request: { url: '/rest/v1/rpc/fn_red_numar_document' }, message: 'Eroare generare convocator' })
    const ev2 = { request: { url: '/rest/v1/rpc/fn_red_numar_document', data: { p_uat: 3 } }, extra: { continut_hash: 'a'.repeat(64) }, message: 'x' }
    expect(scrubSentryEvent(ev2)).toEqual({ request: { url: '/rest/v1/rpc/fn_red_numar_document' }, message: 'x' })
    // in afara contextului, hash-ul legitim ramane
    const ev3 = { request: { url: '/rest/v1/rpc/fn_altceva' }, extra: { continut_hash: 'a'.repeat(64) }, message: 'x' }
    expect(scrubSentryEvent(ev3)).toEqual(ev3)
  })
  it('r12 P1-1 (Jakarinos): corp de cerere ca ȘIR JSON cu cheie `token` structurală ([null, T], {nested:{value:T}}) + ref_<T>', () => {
    for (const body of [JSON.stringify({ token: [null, T] }), JSON.stringify({ token: { nested: { value: T } } }), encodeURIComponent(JSON.stringify({ x: 1, raspuns: { lista: ['a', { t: T }] } })), JSON.stringify({ inner: JSON.stringify({ token: [T] }) })]) {
      const rez = scrubSentryEvent({ request: { url: '/rest/v1/rpc/fn_red_numar_document', body }, message: 'ref_' + T })
      expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
  })
  it('Copilot FE r7 P2-01: corp JSON peste limita parserului (200k) / JSON invalid cu cheie token ⇒ purtător ⇒ null', () => {
    const mare = { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body: JSON.stringify({ token: [null, T], padding: 'x'.repeat(200000) }) } }
    const rm = scrubSentryEvent(mare); expect(rm === null || !JSON.stringify(rm).includes(T)).toBe(true)   // r46: context Redari -> schelet sigur
    expect(scrubSentryEvent({ message: 'ref_' + T, request: { url: '/intern', body: JSON.stringify({ token: [null, T], padding: 'x'.repeat(200000) }) } })).toBeNull()
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
    for (const ev of [{ message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } }, { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body: JSON.stringify({ padding: 'x'.repeat(200000), token: [null, T] }) } }]) {
      const r = scrubSentryEvent(ev); expect(r === null || !JSON.stringify(r).includes(T)).toBe(true)   // r46: context Redari -> schelet sigur
    }
    expect(scrubSentryEvent({ message: 'ref_' + T, request: { url: '/intern', body } })).toBeNull()
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
    expect(JSON.stringify(s1)).not.toContain(T); expect(s1.op).toBe('redactat'); expect(s1.span_id).toBeUndefined(); expect(s1.origin).toBeUndefined()   // r45 P1-03: fara id-uri
    const s2 = scrubSentrySpan({ span_id: T, trace_id: 'abc', op: 'ref_' + T, data: { payload: '{"token":[null,"' + T + '"' } })   // refuzat -> golit
    expect(JSON.stringify(s2)).not.toContain(T); expect(s2.span_id).toBeUndefined(); expect(s2.trace_id).toBeUndefined()
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
  it('r26 P1-1 (Jakarinos): token la >200 de caractere dupa cuvantul-cheie, in text neparcurs - tot indiciu (fara prag de distanta)', () => {
    for (const body of ['{ token: \'' + 'x'.repeat(500) + T + '\' }', 'raspuns ' + '.'.repeat(1000) + ' ' + T, 'TOKEN\n' + 'a b '.repeat(300) + T]) {
      for (const ev of [
        { message: T, request: { url: '/rest/v1/rpc/fn_red_numar_document', body } },
        { message: 'ref_' + T, extra: { payload: body } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { payload: body } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
  })
  it('r26 P2-1 (Jakarinos): corp OBIECT valid cu `tokenuri_cumparate: 12` si un hash in campul vecin + hash in extra -> evenimentul trece', () => {
    const hash = 'a'.repeat(64)
    const ev = { message: 'Eroare interna', request: { url: '/intern', data: { tokenuri_cumparate: 12, hash } }, extra: { sha256: hash } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'Eroare interna', request: { url: '/intern', data: { tokenuri_cumparate: 12, hash } }, extra: { sha256: hash } })
    // DECIZIE r27 (Copilot r21 P1-01 vs r20 P2-01): in TEXT neparcurs un hash (hex sau base64url de 43) e indistinct de un token ->
    // securitatea castiga: acelasi continut ca TEXT e indiciu si evenimentul se pierde (cost acceptat, documentat in sentryScrub.js)
    expect(scrubSentryEvent({ message: 'x', request: { url: '/intern', body: 'tokenuri_cumparate: 12, hash: ' + hash }, extra: { sha256: hash } })).toBeNull()
    expect(scrubSentryEvent({ message: 'x', request: { url: '/intern', body: 'tokenuri_cumparate: 12, v: ' + T }, extra: { sha256: hash } })).toBeNull()
    expect(scrubSentryEvent({ message: 'raspuns salvat, hash ' + hash, extra: { sha256: hash } })).toBeNull()
    // un token pur hexazecimal (teoretic valid) sub cuvant-cheie in text -> tot indiciu
    const Thex = 'abcdef0123456789abcdef0123456789abcdef01234'
    const rh = scrubSentryEvent({ message: 'ref_' + Thex, extra: { payload: 'token => ' + Thex } })
    expect(rh === null || !JSON.stringify(rh).includes(Thex)).toBe(true)
    // fara cuvant-cheie: hash-ul in text trece (nu e purtator)
    expect(scrubSentryEvent({ message: 'Eroare: fisier ' + hash, extra: { sha256: hash } })?.extra?.sha256).toBe(hash)
  })
  it('r27 P2-1 (Jakarinos): corp-SIR care se parseaza ca JSON e tratat structural - hash base64url de 43 in campul vecin nu pierde evenimentul', () => {
    const hash = 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0'   // SHA-256 in base64url: exact 43, indistinct de un token ca text
    const data = { tokenuri_cumparate: 12, hash }
    const ev = { message: 'Eroare interna', request: { url: '/intern', data: JSON.stringify(data) }, extra: { sha256: hash } }
    expect(scrubSentryEvent(ev)).toEqual({ message: 'Eroare interna', request: { url: '/intern', data: JSON.stringify(data) }, extra: { sha256: hash } })
    // dar sub o cheie de token, structural, acelasi hash E token (colectat si redactat)
    const ev2 = { message: 'x ' + hash, request: { url: '/intern', data: JSON.stringify({ token: hash }) } }
    const r2 = scrubSentryEvent(ev2); expect(r2 === null || !JSON.stringify(r2).includes(hash)).toBe(true)
  })
  it('r28 P1-1 (Jakarinos): cheie codificata de 4+ ori (`%25252574oken`) e AMBIGUA dupa limita de decodare -> purtator -> null', () => {
    for (const cheie of ['%25252574oken', '%2525252570_token', '%252525252572aspuns']) {
      for (const ev of [
        { message: 'ref_' + T, request: { url: '/rest/v1/rpc/fn_red_numar_document', data: { [cheie]: [null, T] } } },
        { message: 'ref_' + T, extra: { [cheie]: { v: T } } },
        { message: 'ref_' + T, extra: { x: cheie + '=' + T } },
      ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'ref_' + T, data: { [cheie]: [T] } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
    // legitim: `%25` (procent codificat o data) + hash -> nu e ambiguu, trece
    expect(scrubSentryEvent({ message: 'reducere 10%25 aplicata', extra: { sha256: 'a'.repeat(64) } })?.message).toBe('reducere 10%25 aplicata')
  })
  it('r28 P2-1 (Jakarinos) - COST DOCUMENTAT: regula textuala e globala; un message din alt modul cu `token` + secventa de 43 se pierde', () => {
    expect(scrubSentryEvent({ message: 'Facturare: tokenuri_cumparate=12, hash=' + 'h'.repeat(43), request: { url: '/facturi' } })).toBeNull()
    // fara cuvant-cheie, acelasi message trece
    expect(scrubSentryEvent({ message: 'Facturare: credite=12, hash=' + 'h'.repeat(43), request: { url: '/facturi' } })?.message).toContain('Facturare')
  })
  it('r29 P1-1 (Jakarinos): chei JSON DUPLICATE (JSON.parse pastreaza ultima) - textul e tratat conservator', () => {
    const text = '{"token":{"value":"prefix ' + T + '"},"token":null}'
    for (const ev of [
      { extra: { nota: text } },
      { message: 'ref_' + T, request: { url: '/intern', data: text } },
      { message: 'x', extra: { nota: '{"a":{"raspuns":["' + T + '"]},"a":{"raspuns":[]}}' } },
      { message: 'x', extra: { nota: '{"p_token":"' + T + '","p_token":"scurt"}' } },
    ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true) }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'operatie interna', data: { nota: text } })
    expect(JSON.stringify(sp)).not.toContain(T)
    // JSON fara duplicate, cu campuri vecine legitime: neschimbat
    const hash = 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0'
    const ok = { message: 'x', extra: { nota: JSON.stringify({ tokenuri_cumparate: 12, hash, alt: { tokens: [1, 2] } }) } }
    expect(scrubSentryEvent(ok)).toEqual({ message: 'x', extra: { nota: JSON.stringify({ tokenuri_cumparate: 12, hash, alt: { tokens: [1, 2] } }) } })
  })
  it('r30 P1-1 (Jakarinos): chei duplicate scrise cu escape Unicode (`"to\\u006ben"`) sau mixte - detectate pe TOATE cheile', () => {
    const u = '"to\\u006ben"'
    expect(u.includes('\\u006b')).toBe(true)
    for (const payload of [
      '{' + u + ':{"value":"prefix ' + T + '"},' + u + ':null}',
      '{' + u + ':{"value":"prefix ' + T + '"},"token":null}',
      '{"token":{"value":"prefix ' + T + '"},' + u + ':null}',
      '{"a":1,"x":{"\\u0070_token":["' + T + '"]},"x":{}}',
    ]) {
      for (const ev of [{ extra: { nota: payload } }, { message: 'ref_' + T, request: { url: '/intern', data: payload } }]) {
        const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
      }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { nota: payload } })
      expect(JSON.stringify(sp)).not.toContain(T)
    }
  })
  it('r31 P1-1 (Jakarinos): duplicat + escape Unicode IN MIJLOCUL tokenului (rupe secventa de 43 in text) - duplicatele => refuzat neconditionat', () => {
    const Tesc = T.slice(0, 20) + '\\u00' + T.charCodeAt(20).toString(16).padStart(2, '0') + T.slice(21)   // T cu al 21-lea caracter ca \\uXXXX
    expect(JSON.parse('"' + Tesc + '"')).toBe(T)
    const payload = '{"to\\u006ben":{"value":"' + Tesc + '"},"to\\u006ben":null}'
    for (const ev of [{ message: T, extra: { nota: payload } }, { message: T, request: { url: '/intern', data: payload } }]) {
      const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: T, data: { nota: payload } })
    expect(JSON.stringify(sp)).not.toContain(T)
    // duplicat fara nicio secventa lunga + hash in alt camp: se pierde (cost acceptat - duplicatele sunt oricum anormale)
    expect(scrubSentryEvent({ message: 'x', extra: { nota: '{"a":1,"a":2}', sha256: 'a'.repeat(64) } })).toBeNull()
  })
  it('r32 P1-1 (Jakarinos): `refuzat` => eveniment eliminat / span golit NECONDITIONAT (identificatorul poate sta doar sub escape-uri Unicode)', () => {
    const U = T.slice(0, 20) + '\\u0055' + T.slice(21)
    const payload = '{"to\\u006ben":{"value":"' + U + '"},"to\\u006ben":null}'
    expect(scrubSentryEvent({ message: 'x', extra: { nota: payload } })).toBeNull()
    expect(scrubSentryEvent({ message: 'x', request: { url: '/intern', data: payload } })).toBeNull()
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { nota: payload } })
    expect(sp.description).toBe('[redactat]'); expect(JSON.stringify(sp)).not.toContain('u0055')
    // si celelalte surse de `refuzat`: JSON prea mare cu indiciu, cheie codificata de 4+ ori - fara copie in clar => tot null
    expect(scrubSentryEvent({ message: 'x', extra: { payload: JSON.stringify({ token: [null, U], padding: 'x'.repeat(200000) }) } })).toBeNull()
    expect(scrubSentryEvent({ message: 'x', extra: { '%25252574oken': [null, 'scurt'] } })?.message).toBe('x')   // r33: semnal slab, fara secventa de 43 -> trece
  })
  it('r33 P1-1 (Jakarinos): JSON VALID (fara duplicate) cu escape Unicode in mijlocul identificatorului - redactat in extra, request.data, span', () => {
    const U = T.slice(0, 20) + '\\u00' + T.charCodeAt(20).toString(16).padStart(2, '0') + T.slice(21)   // al 21-lea caracter ca \\uXXXX
    const payload = '{"token":"' + U + '"}'
    expect(JSON.parse(payload).token).toBe(T)
    for (const ev of [{ message: 'x', extra: { nota: payload } }, { message: 'x', request: { url: '/intern', data: payload } }, { message: 'x', extra: { lista: [payload, { adanc: payload }] } }]) {
      const rez = scrubSentryEvent(ev)
      if (rez !== null) { const j = JSON.stringify(rez); expect(j).not.toContain(T); expect(j).not.toContain(U) }
    }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { nota: payload } })
    expect(JSON.stringify(sp)).not.toContain(U); expect(JSON.stringify(sp)).not.toContain(T)
  })
  it('r33 P2-1 (Jakarinos): escape Unicode singur sau %-codificare ramasa, FARA cuvant-cheie/identificator -> evenimentul trece', () => {
    expect(scrubSentryEvent({ message: 'Caracter primit: \\u0041' })).toEqual({ message: 'Caracter primit: \\u0041' })
    expect(scrubSentryEvent({ message: 'Link: /documente/%25252520' })).toEqual({ message: 'Link: /documente/%25252520' })
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'Caracter \\u0041', data: {} })
    expect(sp.description).toBe('Caracter \\u0041')
    // r39: cheia codificata de 4 ori se decodeaza complet (8 pasi alternante) -> e cheie `token`: valoarea de tip identificator se redacteaza
    const r4 = scrubSentryEvent({ message: 'x', extra: { '%25252574oken': [null, T] } }); expect(r4 === null || !JSON.stringify(r4).includes(T)).toBe(true)
  })
  it('r34 P1-1 (Jakarinos): semnalul `ambiguu` se propaga din JSON-ul parsat (cheie `\\u0025...` = %-codificare ascunsa sub escape Unicode)', () => {
    const payload = '{"\\u002525252574oken":"' + T + '"}'
    expect(Object.keys(JSON.parse(payload))[0]).toBe('%25252574oken')
    // r37: cheia inca codificata face subarborele sensibil -> T e colectat si redactat (poate fi null SAU '[token]', niciodata T)
    for (const ev of [{ extra: { payload } }, { request: { url: '/intern', data: payload } }, { extra: { outer: JSON.stringify({ inner: payload }) } }]) {
      const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'intern', data: { payload } })
    expect(JSON.stringify(sp)).not.toContain(T)
  })
  it('Copilot r28 P1-01: identificator codificat caracter cu caracter de 4 ori (`%25252541`×43) sub cheie sensibila -> refuzat -> null', () => {
    const E = '%25252541'.repeat(43)   // fiecare A = %41, apoi % codificat inca de 3 ori
    for (const ev of [
      { extra: { token: E } },
      { request: { url: '/intern', data: { p_token: [null, E] } } },
      { extra: { nota: 'token=' + E } },
      { extra: { nota: JSON.stringify({ raspuns: { v: E } }) } },
    ]) { const rez = scrubSentryEvent(ev); expect(rez === null || (!JSON.stringify(rez).includes('%25252541') && !JSON.stringify(rez).includes(T))).toBe(true) }   // r39: null SAU redactat, niciodata E/T
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { token: E } })
    expect(JSON.stringify(sp)).not.toContain('%25252541'); expect(JSON.stringify(sp)).not.toContain(T)
    // fara context sensibil si fara cuvant-cheie: semnal slab -> trece daca nu ramane nicio secventa de 43
    expect(scrubSentryEvent({ message: 'x', extra: { cale: '/doc/%25252520' } })?.message).toBe('x')
  })
  it('r36 P1-01/P1-02 (Jakarinos): cheie SI valoare codificate de 4 ori; procentele ascunse sub escape Unicode; P2-01: valoare scurta legitima sub cheie token trece', () => {
    let E = [...T].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    for (let i = 0; i < 3; i++) E = encodeURIComponent(E)
    const U = E.replaceAll('%', '\\u0025')
    for (const ev of [
      { extra: { '%25252574oken': E } },
      { extra: { token: U } },
      { extra: { '%25252574oken': U } },
      { request: { url: '/intern', data: { x: { '%25252574oken': [E] } } } },
      { extra: { nota: JSON.stringify({ token: U }) } },
    ]) { const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez); expect(!j.includes(E) && !j.includes(U) && !j.includes(T)).toBe(true) }   // r39: null SAU redactat (cheia `%25252574oken` poate ramane - nu e identificatorul)
    for (const data of [{ '%25252574oken': E }, { token: U }]) {
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data })
      const j = JSON.stringify(sp); expect(!j.includes(E) && !j.includes(U) && !j.includes(T)).toBe(true)
    }
    // P2-01: valoare scurta inca codificata sub cheie cu `token` in nume -> NU poate ascunde 43 de caractere -> trece
    expect(scrubSentryEvent({ message: 'Eroare OAuth', extra: { token_endpoint: '/oauth/%25252520' } })).toEqual({ message: 'Eroare OAuth', extra: { token_endpoint: '/oauth/%25252520' } })
  })
  it('r37 P1-01 (Jakarinos): identificator codificat PARTIAL (un singur caracter %25252555) sub cheie sensibila / cheie codificata / cu escape / in JSON', () => {
    const E = T.slice(0, 20) + '%25252555' + T.slice(21)
    for (const ev of [
      { extra: { token: E } },
      { extra: { '%25252574oken': E } },
      { extra: { token: E.replace('%', '\\u0025') } },
      { extra: { nota: JSON.stringify({ token: E }) } },
      { request: { url: '/intern', data: { p_token: [null, E] } } },
    ]) { const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes('25252555')).toBe(true) }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { token: E } })
    expect(JSON.stringify(sp)).not.toContain('25252555')
    // legitim: scurt sub cheie token, inca codificat -> trece
    expect(scrubSentryEvent({ message: 'Eroare OAuth', extra: { token_endpoint: '/oauth/%25252520' } })?.message).toBe('Eroare OAuth')
  })
  it('r38 P1-01 (Jakarinos): alternarea Unicode -> procentual -> Unicode (`\\u00255Cu0055`) se reconstruieste; P2-01: URL lung legitim cu separatori trece', () => {
    const E = T.slice(0, 20) + '\\u00255Cu00' + T.charCodeAt(20).toString(16).padStart(2, '0') + T.slice(21)
    for (const ev of [{ message: 'ok', extra: { token: E } }, { message: 'ok', extra: { nota: JSON.stringify({ token: E }) } }, { message: 'ok', request: { url: '/intern', data: { p_token: [E] } } }]) {
      const rez = scrubSentryEvent(ev); expect(rez === null || !JSON.stringify(rez).includes('5Cu00')).toBe(true); expect(rez === null || !JSON.stringify(rez).includes(T)).toBe(true)
    }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { token: E } })
    expect(JSON.stringify(sp)).not.toContain('5Cu00')
    // alternare mai adanca (6 pasi) sub cheie sensibila -> refuzat (limita atinsa) -> null
    let F = [...T].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')   // fiecare caracter %XX
    for (let i = 0; i < 4; i++) F = encodeURIComponent(F.replaceAll('%', '\\u0025'))   // alternare: % -> \u0025 -> encodeURIComponent (backslash -> %5C)
    expect(F).not.toBe(T); expect(F.includes('%5Cu0025')).toBe(true)
    const r2 = scrubSentryEvent({ message: 'ok', extra: { token: F } }); expect(r2 === null || (!JSON.stringify(r2).includes(T) && !JSON.stringify(r2).includes(F))).toBe(true)   // r40 P2-01: nici F (reprezentarea recuperabila) nu ramane
    // P2-01: URL legitim lung cu separatori, inca codificat, sub cheie token -> nu poate ascunde 43 -> trece
    const url = '/oauth/provider/session/authorization/callback/%25252520'
    expect(scrubSentryEvent({ message: 'Eroare OAuth', extra: { token_endpoint: url } })).toEqual({ message: 'Eroare OAuth', extra: { token_endpoint: url } })
  })
  it('r39 P1-01 (Jakarinos): JSON codificat procentual de 9/10/11 ori (cuvantul-cheie insusi ascuns) in message / request.data / extra / span -> nu se trimite', () => {
    for (const n of [9, 10, 11]) {
      let E = [...JSON.stringify({ token: T })].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
      for (let i = 1; i < n; i++) E = encodeURIComponent(E)
      for (const ev of [{ message: E }, { message: 'x', request: { url: '/intern', data: E } }, { message: 'x', extra: { nota: JSON.stringify({ a: E }) } }]) expect(scrubSentryEvent(ev)).toBeNull()
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: E, data: {} })
      expect(sp.description).toBe('[redactat]')
    }
    // la 8 niveluri se decodeaza complet -> structural: redactat sau null, fara T
    let E8 = [...JSON.stringify({ token: T })].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
    for (let i = 1; i < 8; i++) E8 = encodeURIComponent(E8)
    const r8 = scrubSentryEvent({ message: E8 }); expect(r8 === null || !JSON.stringify(r8).includes(T)).toBe(true)
    // legitim: text scurt inca codificat adanc (nu poate ascunde 43) -> trece
    let scurt = '%41'; for (let i = 0; i < 9; i++) scurt = encodeURIComponent(scurt)
    expect(scrubSentryEvent({ message: 'cod: ' + scurt })?.message).toBe('cod: ' + scurt)
  })
  it('r40 P1-01 (Jakarinos): escape JavaScript `\\xHH` (si `\\u{..}`) in copia identificatorului - eveniment si span', () => {
    const h = T.charCodeAt(20).toString(16).padStart(2, '0')
    for (const E of [T.slice(0, 20) + '\\x' + h + T.slice(21), T.slice(0, 20) + '\\u{' + h + '}' + T.slice(21), T.slice(0, 10) + '\\x' + T.charCodeAt(10).toString(16) + T.slice(11, 20) + '\\u00' + h + T.slice(21)]) {
      expect(E).not.toBe(T)
      for (const ev of [{ extra: { token: T, copy: E } }, { message: E, extra: { token: T } }, { extra: { nota: JSON.stringify({ token: T, copy: E }) } }, { extra: { token: E } }]) {
        const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez)
        expect(!j.includes(T) && !j.includes(E) && !j.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
      }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: E, data: { token: T } })
      const js = JSON.stringify(sp); expect(!js.includes(T) && !js.includes(E) && !js.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
    }
    // legitim: `\\x41` singur fara identificator -> trece
    expect(scrubSentryEvent({ message: 'Caracter: \\x41' })?.message).toBe('Caracter: \\x41')
  })
  it('r41 P1-01 (Jakarinos): escape octal `\\125` si escape de identitate `\\U` in copia identificatorului - eveniment si span', () => {
    const c = T[20]
    const oct = c.charCodeAt(0).toString(8)
    for (const E of [T.slice(0, 20) + '\\' + oct + T.slice(21), T.slice(0, 20) + '\\' + c + T.slice(21), T.slice(0, 12) + '\\' + T[12] + T.slice(13, 20) + '\\' + oct + T.slice(21, 30) + '\\x' + T.charCodeAt(30).toString(16) + T.slice(31)]) {   // identitate pe o LITERA (o cifra ar fi escape octal)
      expect(E).not.toBe(T)
      for (const ev of [{ extra: { token: T, copy: E } }, { message: E, extra: { token: T } }, { extra: { nota: JSON.stringify({ token: T, copy: E }) } }, { extra: { token: E } }]) {
        const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez)
        expect(!j.includes(T) && !j.includes(E) && !j.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
      }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: E, data: { token: T } })
      const js = JSON.stringify(sp); expect(!js.includes(T) && !js.includes(E) && !js.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
    }
    // legitim: cale Windows cu backslash-uri, fara identificator -> trece
    const cale = 'C:\\Users\\Public\\fisier.txt'
    expect(scrubSentryEvent({ message: 'Fisier lipsa: ' + cale })?.message).toBe('Fisier lipsa: ' + cale)
  })
  it('r42 P1-01/P1-02 (Jakarinos): continuari de linie (backslash + LF/CRLF/U+2028/U+2029) si regula octala JS ([4-7] ia max 2 cifre)', () => {
    const verif = (t, E) => {
      expect(E).not.toBe(t)
      for (const ev of [{ extra: { token: t, copy: E } }, { message: E, extra: { token: t } }, { extra: { nota: JSON.stringify({ token: t, copy: E }) } }, { extra: { token: E } }]) {
        const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez)
        expect(!j.includes(t) && !j.includes(E) && !j.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
      }
      const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: E, data: { token: t } })
      const js = JSON.stringify(sp); expect(!js.includes(t) && !js.includes(E) && !js.includes(JSON.stringify(E).slice(1, -1))).toBe(true)
    }
    for (const nl of ['\n', '\r\n', '\r', '\u2028', '\u2029']) verif(T, T.slice(0, 20) + '\\' + nl + T.slice(20))
    // octal: `\\600` = `\\60` ('0') + '0'; `\\700` = '8' + '0'; `\\555` = '-' + '5'
    const t1 = T.slice(0, 20) + '00' + T.slice(22); verif(t1, t1.slice(0, 20) + '\\600' + t1.slice(22))
    const t2 = T.slice(0, 20) + '80' + T.slice(22); verif(t2, t2.slice(0, 20) + '\\700' + t2.slice(22))
    const t3 = T.slice(0, 20) + '-5' + T.slice(22); verif(t3, t3.slice(0, 20) + '\\555' + t3.slice(22))
    // legitim: text multilinie cu backslash la capat de linie, fara identificator -> trece
    const txt = 'linia 1 \\\nlinia 2'
    expect(scrubSentryEvent({ message: txt })?.message).toBe(txt)
  })
  it('r43 P1-01 (Jakarinos): copia identificatorului FRAGMENTATA (lista de bucati, campuri separate) cand identificatorul e cunoscut -> nu se trimite', () => {
    const buc = [T.slice(0, 20), T.slice(20)]
    const buc3 = [T.slice(0, 10), T.slice(10, 25), T.slice(25)]
    for (const ev of [
      { extra: { token: T, copy: buc } },
      { extra: { token: buc } },
      { extra: { token: T, a: buc3[0], b: { c: buc3[1] }, d: [buc3[2]] } },
      { message: 'x ' + T.slice(0, 15) + ' y', extra: { token: T, rest: T.slice(15) } },
      { extra: { nota: JSON.stringify({ token: T, copy: buc }) } },
    ]) {
      const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez).replace(/[^A-Za-z0-9_-]+/g, '')
      expect(j.includes(T)).toBe(false)
      for (const b of [...buc, ...buc3]) expect(j.includes(b)).toBe(false)
    }
    const sp = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: T.slice(0, 20), data: { token: T, rest: T.slice(20) } })
    expect(sp.description).toBe('[redactat]'); expect(JSON.stringify(sp)).not.toContain(T.slice(20))
    // legitim: identificator colectat + alte siruri scurte fara legatura -> trece (redactat)
    const ok = scrubSentryEvent({ message: 'convocator generat', extra: { token: T, id_parcela: 'T3-HUS-0001', uat: 'Husnicioara' } })
    expect(ok).toEqual({ message: 'convocator generat', extra: { token: '[token]', id_parcela: 'T3-HUS-0001', uat: 'Husnicioara' } })
  })
  it('r44 (Jakarinos): fragmente in obiect/liste imbricate sub cheia sensibila; fragmente ordonate de 5 cu indici; id-uri de span ca bucati; coincidenta de 6 legitima trece', () => {
    // P1-01
    for (const ev of [{ extra: { token: { a: T.slice(0, 20), b: T.slice(20) } } }, { extra: { token: [[T.slice(0, 20)], [T.slice(20)]] } }, { extra: { p_token: { x: { y: T.slice(0, 7) }, z: [T.slice(7, 30), { w: T.slice(30) }] } } }]) {
      const rez = scrubSentryEvent(ev); const j = rez === null ? '' : JSON.stringify(rez).replace(/[^A-Za-z0-9_-]+/g, '')
      expect(j.includes(T)).toBe(false); expect(j.includes(T.slice(20))).toBe(false)
    }
    // P1-02: fragmente de 5 cu indici intre ele, identificatorul cunoscut
    const copy = T.match(/.{1,5}/g).map((v, i) => ({ i, v }))
    expect(scrubSentryEvent({ extra: { token: T, copy } })).toBeNull()
    expect(scrubSentryEvent({ extra: { token: T, copy: T.match(/.{1,3}/g) } })).toBeNull()
    const sp2 = scrubSentrySpan({ span_id: 'ab', trace_id: 'cd', description: 'x', data: { token: T, copy } })
    expect(sp2.description).toBe('[redactat]'); expect(JSON.stringify(sp2)).not.toContain(T.slice(0, 5))
    // P1-03: id-uri hex care sunt bucati din identificatorul colectat
    const H = '0123456789abcdef0123456789abcdef0123456789a'
    const sp = scrubSentrySpan({ span_id: H.slice(0, 16), trace_id: H.slice(11), description: 'copy ' + H.slice(0, 20), data: { token: H } })
    expect(sp.span_id).toBeUndefined(); expect(sp.trace_id).toBeUndefined(); expect(sp.description).toBe('[redactat]')
    // P2-01: coincidenta de 6 caractere cu o valoare legitima NU pierde evenimentul (redactat)
    expect(scrubSentryEvent({ extra: { token: T, id: '012345', message: 'eroare' } })).toEqual({ extra: { token: '[token]', id: '012345', message: 'eroare' } })
  })
  it('r46 CONTROL PRINCIPAL: evenimentele din contextul Redari (URL /redari, rpc/fn_red_*, breadcrumb) pastreaza doar campurile sigure', () => {
    const ev = { event_id: 'e1', timestamp: 1, level: 'error', message: 'Registru: eroare', transaction: '/redari', request: { url: 'https://erp/redari?x=1', method: 'GET', data: { p_token: T }, headers: { Cookie: 'a=b' } },
      extra: { oricare: T.match(/.{1,5}/g).map((v, i) => ({ i: String(i), v })), alt: [T.slice(0, 20), 123, T.slice(23)] }, contexts: { c: { token: { a: T.slice(0, 20), b: T.slice(20) } } }, user: { id: 'u1', email: 'x@y' },
      breadcrumbs: [{ category: 'xhr', data: { url: 'https://api/rest/v1/rpc/fn_red_numar_document', body: T } }],
      exception: { values: [{ type: 'TypeError', value: 'x is undefined', stacktrace: { frames: [{ filename: 'app://src/Redari.jsx', function: 'incarca', lineno: 170, colno: 5, in_app: true, vars: { token: T } }] } }] } }
    expect(esteDinContextRedari(ev)).toBe(true)
    const rez = scrubSentryEvent(ev)
    expect(rez).not.toBeNull()
    const j = JSON.stringify(rez)
    expect(j).not.toContain(T); expect(j).not.toContain(T.slice(0, 5)); expect(j).not.toContain('x@y'); expect(j).not.toContain('Cookie')
    expect(rez.extra).toBeUndefined(); expect(rez.contexts).toBeUndefined(); expect(rez.breadcrumbs).toBeUndefined(); expect(rez.user).toBeUndefined(); expect(rez.request.data).toBeUndefined(); expect(rez.request.headers).toBeUndefined()
    expect(rez.message).toBe('Registru: eroare'); expect(rez.exception.values[0].type).toBe('TypeError'); expect(rez.exception.values[0].stacktrace.frames[0].filename).toBe('app://src/Redari.jsx'); expect(rez.exception.values[0].stacktrace.frames[0].vars).toBeUndefined()
    // context si prin breadcrumb/transaction singure; NU prin cuvinte din message
    expect(esteDinContextRedari({ transaction: '/redari/registru' })).toBe(true)
    expect(esteDinContextRedari({ breadcrumbs: [{ data: { to: '/redari' } }] })).toBe(true)
    expect(esteDinContextRedari({ message: 'redari teren', request: { url: '/logistica' } })).toBe(false)
    expect(esteDinContextRedari({ request: { url: '/redarile' } })).toBe(false)
    // un message lung cu secventa de 43 nu trece in forma sigura
    expect(doarCampurileSigure({ message: 'x ' + T, level: 'error' }).message).toBeUndefined()
  })
  it('r45 (Jakarinos): indici-sir, fragmente numerice, span golit fara id-uri, cuvinte legitime unite NU inventeaza identificatori', () => {
    // P1-01: indici ca siruri
    expect(scrubSentryEvent({ extra: { token: T, copy: T.match(/.{1,5}/g).map((v, i) => ({ i: String(i), v })) } })).toBeNull()
    // P1-02: fragmente numerice sub cheia sensibila
    const bucati = T.match(/.{1,5}/g).map(v => /^\d+$/.test(v) ? Number(v) : v)
    const r2 = scrubSentryEvent({ extra: { token: bucati } }); const j2 = r2 === null ? '' : JSON.stringify(r2).replace(/[^A-Za-z0-9_-]+/g, '')
    expect(j2.includes(T)).toBe(false)
    // P1-03: span golit (si pe iesirea anticipata de formular public, si pe exceptie) nu pastreaza id-urile
    const H = '0123456789abcdef0123456789abcdef0123456789a'
    const s1 = scrubSentrySpan({ span_id: H.slice(0, 16), trace_id: H.slice(11), description: '/redari/raspuns/' + H, data: {} })
    expect(s1.span_id).toBeUndefined(); expect(s1.trace_id).toBeUndefined()
    const s2 = { span_id: H.slice(0, 16), trace_id: H.slice(11), description: 'x', data: {} }; Object.defineProperty(s2, 'rau', { enumerable: true, get() { throw new Error('x') } })
    const r3 = scrubSentrySpan(s2); expect(r3.span_id).toBeUndefined(); expect(r3.trace_id).toBeUndefined()
    // P2-01: cuvinte legitime sub `token_cache` unite (47) NU inventeaza un identificator -> evenimentul trece
    const ok = { message: 'Refresh failed', extra: { token_cache: { provider: 'identity-provider', status: 'temporarily-unavailable', operation: 'refresh' } } }
    expect(scrubSentryEvent(ok)).toEqual(ok)
  })
  it('r46 (Jakarinos): in context Redari identificatorii se colecteaza INAINTE de allow-list; textele pastrate se verifica decodat; context din breadcrumb.message; cost liniar', () => {
    // P1-01: sursa (extra.token) dispare, dar fragmentele din tags/message/exception.value raman cunoscute -> eliminat
    const rt = scrubSentryEvent({ transaction: '/redari', extra: { token: T }, tags: { a: T.slice(0, 20), b: T.slice(20) } })
    expect(rt === null || (rt.tags === undefined && !JSON.stringify(rt).includes(T.slice(0, 20)))).toBe(true)   // r48: tags nu mai exista in schelet
    expect(scrubSentryEvent({ transaction: '/redari', extra: { token: T }, message: 'x ' + T.slice(0, 20), exception: { values: [{ type: 'E', value: T.slice(20) }] } })).toBeNull()
    // P1-02: un singur caracter %-codificat in message, in context Redari -> nu trece in schelet
    const r2 = scrubSentryEvent({ transaction: '/redari', message: T.slice(0, 20) + '%' + T.charCodeAt(20).toString(16) + T.slice(21) })
    expect(r2 === null || r2.message === undefined).toBe(true)
    // P2-01: contextul si din breadcrumb.message
    expect(esteDinContextRedari({ breadcrumbs: [{ message: 'navigare la /redari' }] })).toBe(true)
    const r3 = scrubSentryEvent({ breadcrumbs: [{ message: 'navigare la /redari' }], extra: { token: [T.slice(0, 20), 'label', T.slice(20)] } })
    expect(r3 === null || !JSON.stringify(r3).includes(T.slice(0, 20))).toBe(true)
    // P2-02: lant adanc sub cheie sensibila — rapid (reunirea doar la radacina subarborelui)
    let lant = { v: 'x' }; const rad = lant; for (let i = 0; i < 3000; i++) { lant.next = { v: 'y' + i }; lant = lant.next }
    const t0 = Date.now(); const r4 = scrubSentryEvent({ message: 'ok', extra: { token_cache: rad } }); expect(Date.now() - t0).toBeLessThan(2000); expect(r4).not.toBeNull()
  })
  it('r47 (Jakarinos): chei tags cu fragmente; etichete intre fragmente; lista imbricata cu eticheta sub cheie sensibila; eveniment normal in context trece', () => {
    // P1-01: tags nu mai exista in schelet
    const r1 = scrubSentryEvent({ transaction: '/redari', tags: { [T.slice(0, 20)]: '!', [T.slice(20)]: '!' } })
    expect(r1 === null || r1.tags === undefined).toBe(true)
    // P1-02: etichete scurte intre fragmente in textele scheletului -> secventele >=12 unite = identificator -> null
    expect(scrubSentryEvent({ transaction: '/redari', message: 'prima: ' + T.slice(0, 20), exception: { values: [{ type: 'Error', value: 'ultima: ' + T.slice(20) }] } })).toBeNull()
    // P1-03 [in afara contextului]: lista imbricata cu eticheta sub cheia sensibila
    const r3 = scrubSentryEvent({ message: 'ok', extra: { token: { label: 'prefix ', nested: [T.slice(0, 20), T.slice(20)] } } })
    expect(r3 === null || !JSON.stringify(r3).replace(/[^A-Za-z0-9_-]+/g, '').includes(T)).toBe(true)
    // P2-01: eveniment normal in context (event_id hex 32 + timestamp + platform) TRECE
    const ok = { event_id: 'a'.repeat(32), timestamp: 1762041600, platform: 'javascript', level: 'error', transaction: '/redari', message: 'TypeError: x', exception: { values: [{ type: 'TypeError', value: 'Cannot read properties of undefined (reading nume_normalizat)', stacktrace: { frames: [{ filename: 'app://src/Redari.jsx', function: 'incarcaDetinatoriParcela', lineno: 1 }, { filename: 'app://src/redari/ui/FisaParcela.jsx', function: 'reincarcaConvocatorVersiuneNoua', lineno: 2 }] } }] } }
    const rok = scrubSentryEvent(ok); expect(rok).not.toBeNull(); expect(rok.message).toBe('TypeError: x'); expect(rok.exception.values[0].stacktrace.frames.length).toBe(2)
    // r45 P2-01 ramane: cuvinte legitime unite nu inventeaza identificatori
    const ok2 = { message: 'Refresh failed', extra: { token_cache: { provider: 'identity-provider', status: 'temporarily-unavailable', operation: 'refresh' } } }
    expect(scrubSentryEvent(ok2)).toEqual(ok2)
  })
  it('r48 (Jakarinos): release/environment/sdk nu mai sunt canale; mesaje legitime camelCase trec; fragment %-codificat in lista sub cheie sensibila', () => {
    // P1-01 [context]: release/sdk dispar, environment doar din lista
    const r1 = scrubSentryEvent({ transaction: '/redari', release: T.slice(0, 20), environment: T.slice(20), sdk: { name: T.slice(0, 20), version: T.slice(20) } })
    expect(r1 === null || (r1.release === undefined && r1.environment === undefined && r1.sdk === undefined)).toBe(true)
    expect(scrubSentryEvent({ transaction: '/redari', environment: 'production', platform: 'javascript', level: 'error', message: 'x' })).toEqual({ transaction: '/redari', environment: 'production', platform: 'javascript', level: 'error', message: 'x' })
    // P2-01 [context]: mesaj legitim cu identificatori camelCase lungi (doar litere) TRECE
    const m = 'refreshAuthenticationCredentials failed while initializingApplicationConfiguration'
    expect(scrubSentryEvent({ transaction: '/redari', message: m })?.message).toBe(m)
    // dar fragmente cu litere SI cifre (bucati de identificator aleator) unite -> null
    expect(scrubSentryEvent({ transaction: '/redari', message: 'prima: ' + T.slice(0, 20), exception: { values: [{ type: 'Error', value: 'ultima: ' + T.slice(20) }] } })).toBeNull()
    // P1-04 [in afara]: fragment %-codificat in lista sub cheia sensibila
    const r4 = scrubSentryEvent({ message: 'ok', extra: { token: [T.slice(0, 20), '%' + T.charCodeAt(20).toString(16) + T.slice(21)] } })
    expect(r4 === null || !JSON.stringify(r4).replace(/[^A-Za-z0-9_-]+/g, '').includes(T.slice(21))).toBe(true)
  })
  it('r49 P2-01 (Jakarinos): UUID in request.url + nume de proprietate in exception.value NU pierde evenimentul (context Redari)', () => {
    const ev = { transaction: '/redari', request: { url: 'https://erp/redari?id=550e8400-e29b-41d4-a716-446655440000' }, exception: { values: [{ type: 'TypeError', value: 'Cannot read properties of undefined (reading nume_normalizat)' }] } }
    const rez = scrubSentryEvent(ev)
    expect(rez).not.toBeNull(); expect(rez.exception.values[0].value).toBe('Cannot read properties of undefined (reading nume_normalizat)'); expect(rez.request.url).toBe(ev.request.url)
    // si un hash hex in message + identificator de cod: trece
    expect(scrubSentryEvent({ transaction: '/redari', message: 'fisier ' + 'a'.repeat(64) + ' lipsa', exception: { values: [{ type: 'E', value: 'reading nume_normalizat_complet' }] } })).not.toBeNull()
    // dar bucati de identificator aleator (litere+cifre, nu hex) unite din message + value ⇒ null
    expect(scrubSentryEvent({ transaction: '/redari', message: 'prima: ' + T.slice(0, 20), exception: { values: [{ type: 'Error', value: 'ultima: ' + T.slice(20) }] } })).toBeNull()
  })
  it('r50 P2-01 (Jakarinos): timestamp ISO + nume de campuri in message NU pierde evenimentul (context Redari)', () => {
    const ev = { transaction: '/redari', message: '2026-11-02T12:34:56Z: red_detinatori versiune_lista_tgz', exception: { values: [{ type: 'TypeError', value: 'Cannot read properties of undefined (reading nume_normalizat)' }] } }
    const rez = scrubSentryEvent(ev); expect(rez).not.toBeNull(); expect(rez.message).toBe(ev.message)
    // bucati de identificator aleator (litere amestecate cu cifre) unite raman null
    const R = 'Q7w3Zk9pL2xT5vN8mB4cH6jD1sF0gY'   // 30, litere+cifre amestecate
    expect(scrubSentryEvent({ transaction: '/redari', message: 'a: ' + R, exception: { values: [{ type: 'E', value: 'b: ' + 'K3rP8nW2' + 'dV5' + 'xA' }] } })).toBeNull()
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
