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
