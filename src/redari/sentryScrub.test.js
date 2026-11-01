// Redări teren — teste pentru redactarea tokenului public din evenimentele Sentry (src/redari/sentryScrub.js). Tokenuri fictive.
import { describe, it, expect } from 'vitest'
import { redacteazaText, redacteazaAdanc, scrubSentryEvent, evenimentMinim } from './sentryScrub.js'

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
  it('întoarce „[redactat]” când tokenul nu poate fi mapat înapoi (coadă scurtă ascunsă sub codificare dublă)', () => {
    // coada „abc-scurt” e sub pragul de înlocuire globală, iar calea apare doar după două decodări → nu se poate redacta local
    const s = encodeURIComponent(encodeURIComponent('/redari/raspuns/abc-scurt'))
    expect(redacteazaText(s)).toBe('[redactat]')
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
    const rez = scrubSentryEvent(ev)
    const text = JSON.stringify(rez)
    expect(text).not.toContain(T43)
    expect(rez.transaction).toBe('/redari/raspuns/[token]')
    expect(rez.request.url).toBe('https://erp/redari/raspuns/[token]')
    expect(rez.breadcrumbs[0].data.body).toBe('{"p_token":"[token]"}')
    expect(rez.contexts.trace.data.next).toBe('%2Fredari%2Fraspuns%2F[token]')
    expect(rez.exception.values[0].value).toBe('ceva')
  })
})

describe('scrubSentryEvent pe eveniment structurat (Jakarinos r5)', () => {
  it('request.data cu p_token: corpul dispare complet, tokenul nu mai apare nicăieri', () => {
    const ev = { request: { url: 'https://api/rest/v1/rpc/fn_red_raspuns_public', data: { p_token: T43, p_optiune: 'particip' } }, breadcrumbs: [{ message: `trimis ${T43}` }] }
    const rez = scrubSentryEvent(ev)
    expect(rez).not.toBeNull()
    expect(rez.request.data).toBeUndefined()
    expect(rez.breadcrumbs[0].message).toBe('trimis [token]')   // colectat din cheia p_token, înlocuit global chiar fără context
    expect(JSON.stringify(rez)).not.toContain(T43)
  })
  it('tokenul din request.url e colectat și înlocuit și în extra.token (fără context), inclusiv în chei', () => {
    const ev = { request: { url: '/redari/raspuns/' + T43 }, extra: { token: T43, nota: `vezi ${T43} aici`, [T43]: 1 } }
    const rez = scrubSentryEvent(ev)
    expect(rez.request.url).toBe('/redari/raspuns/[token]')
    expect(rez.extra.token).toBe('[token]')
    expect(rez.extra.nota).toBe('vezi [token] aici')
    expect(rez.extra['[token]']).toBe(1)
    expect(JSON.stringify(rez)).not.toContain(T43)
  })
  it('valoarea de 43 a unei chei cu „token” în nume devine [token] chiar fără alt context (token_raspuns)', () => {
    const ev = { contexts: { red: { token_raspuns: T43, altceva: 'x' } } }
    const rez = scrubSentryEvent(ev)
    expect(rez.contexts.red.token_raspuns).toBe('[token]')
    expect(rez.contexts.red.altceva).toBe('x')
  })
  it('request.body se elimină când URL-ul e un RPC al modulului, chiar fără token vizibil', () => {
    const ev = { request: { url: 'https://api/rest/v1/rpc/fn_red_formular_public', body: '{"x":1}', method: 'POST' } }
    const rez = scrubSentryEvent(ev)
    expect(rez.request.body).toBeUndefined()
    expect(rez.request.method).toBe('POST')
  })
  it('nu atinge un eveniment obișnuit', () => {
    const ev = { message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12 } }
    const rez = scrubSentryEvent(ev)
    expect(rez).toEqual({ message: 'TypeError: x', request: { url: 'https://erp/logistica', data: { a: 1 } }, extra: { tokenuri_cumparate: 12 } })
  })
})

describe('scrubSentryEvent la excepție', () => {
  it('întoarce evenimentul minim (fără request.url / breadcrumbs), nu evenimentul brut', () => {
    const ev = { event_id: 'e1', level: 'error', transaction: `/redari/raspuns/${T43}`, request: { url: `https://erp/redari/raspuns/${T43}` }, breadcrumbs: [{ message: T43 }],
      exception: { values: [{ type: 'TypeError', value: `la /redari/raspuns/${T43}` }] } }
    Object.defineProperty(ev, 'capcana', { enumerable: true, configurable: true, get() { throw new Error('getter care aruncă') } })
    const rez = scrubSentryEvent(ev)
    expect(Object.is(rez, ev)).toBe(false)   // nu toBe(ev): vitest ar face deep-equal pe `ev` și ar lovi getter-ul capcană
    expect(rez.request).toBeUndefined()
    expect(rez.breadcrumbs).toBeUndefined()
    expect(rez.event_id).toBe('e1')
    expect(rez.transaction).toBe('/redari/raspuns/[token]')
    expect(rez.exception.values[0].value).toBe('la /redari/raspuns/[token]')
    expect(rez.tags.sentry_scrub).toBe('minim')
    expect(JSON.stringify(rez)).not.toContain(T43)
  })
  it('întoarce null (eveniment eliminat) când și varianta minimă aruncă — getter pe timestamp', () => {
    const ev = { event_id: 'e2', request: { url: `https://erp/redari/raspuns/${T43}` } }
    Object.defineProperty(ev, 'timestamp', { enumerable: true, configurable: true, get() { throw new Error('timestamp care aruncă') } })
    expect(scrubSentryEvent(ev)).toBeNull()
  })
  it('evenimentMinim tolerează evenimente ciudate', () => {
    expect(evenimentMinim(null)).toEqual({ tags: { sentry_scrub: 'minim' } })
    expect(evenimentMinim({ message: { formatted: `p_token=${T43}` } }).message).toBe('p_token=[token]')
  })
})
