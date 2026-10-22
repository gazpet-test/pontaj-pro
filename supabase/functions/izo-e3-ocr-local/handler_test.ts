import { strict as assert } from 'node:assert'
import { handle } from './handler.ts'
import { apelPlatitE3 } from './haiku.ts'
import { ANTET_IZO_OCR, SECRET_IZO_OCR } from '../_shared/izoOcrLocal.ts'
import { ANTET_COMUN, ANTET_SPECIFIC, EroareE3, normalizeazaE3, RAND_NUMAR, RAND_TEXT, validaStructuraE3, valideazaBrutLocalE3, type SablonE3 } from '../ocr-packing-list/avizE3.ts'
import { valideazaCelule, valideazaDecizii } from './contract.ts'
import { type ContextCerere } from './context.ts'
import type { Client } from './rpc.ts'
import { aplicaPropunereOCR } from '../../../src/izoDocumentePrefill.js'
import { randNormalizat } from '../../../src/izoDocumenteLogica.js'
import { readFile } from 'node:fs/promises'

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TOKEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const secret = 'a'.repeat(64)
const celule = [{ rand: 1, camp: 'lungime_doc', lighton: '12.50', mineru: '12.51', sugestie: null }]
const brut = (sablon: SablonE3 = 'aviz_teava') => ({
  antet: Object.fromEntries([...ANTET_COMUN, ...ANTET_SPECIFIC[sablon]].map(k => [k, null])),
  randuri: [{ ...Object.fromEntries([...RAND_TEXT, ...RAND_NUMAR].map(k => [k, null])), nr_crt: '1', serie: '001', lungime_doc: sablon === 'aviz_teava' ? '12.50' : null, pagina: '1', cantitate: sablon === 'lista_curbe' ? '1' : null, cod: sablon === 'lista_curbe' ? '001-610-0009-1' : null, pachet_nr: sablon === 'lista_curbe' ? 'P1' : null, greutate_kg: '1,343', perete_mm: '8,8' }],
  totaluri_tiparite: { total_metri: null, total_kg: null }, avertismente: [], rotatie_grade: 0,
})
function fixture() {
  const events: string[] = [], calls: { fn: string; args: Record<string, unknown> }[] = []
  const c: ContextCerere = { id: ID, creat_de: USER, proiect_id: 1, depozit_id: 2, sablon: 'aviz_teava', drept_platit_de: null, apel_faza: null, apel_raspuns: null, rezervare_id: null, cost_usd: null }
  let admitted = 'admisa', admissionError = 'limita_active', owner = true, access = true, expired = false, jwt = true, goodSecret = true, tokenGood = true, uploadError = false, quota = false, rowState = 'preluata', paid = false
  const q = (t: string) => {
    const data = t === 'profiles' ? { is_owner: owner } : t === 'user_module_access' ? access ? [{ access_level: 'editor' }] : [] : t === 'izo_atribuiri' ? [{ projet: 1, proiect_id: 1, depozit_id: 2, rol: 'gestionar', activ: true, valabil_de: null, valabil_pana: expired ? '2000-01-01' : null }] : t === 'ai_plafon_rezervari' ? { luna: '2026-10-01' } : { cheie: 'izo_e3_ocr:1', luna: '2026-10-01', plafon_usd: 10, consumat_usd: 0, rezervat_usd: .05 }
    const result = { data, error: null }
    const builder = { select: () => builder, eq: () => builder, in: () => builder, limit: () => builder, maybeSingle: () => Promise.resolve(result), single: () => Promise.resolve(result), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve) }
    return builder
  }
  const caller = { auth: { getUser: async () => { events.push('jwt'); return { data: { user: jwt ? { id: USER } : null }, error: null } } }, from: (t: string) => { events.push('caller:' + t); return q(t) } } as unknown as Client
  const ledger = {
    from: (t: string) => { assert.ok(t.startsWith('ai_plafon_'), 'service_role nu autorizează'); return q(t) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      events.push(fn); calls.push({ fn, args })
      const ok = (data: unknown) => ({ data, error: null })
      const fail = (message: string) => ({ data: null, error: { code: 'P0001', message } })
      if (fn === 'fn_verifica_secret') { assert.equal(args.p_nume, SECRET_IZO_OCR); return ok(goodSecret && args.p_secret === secret) }
      if (fn === 'fn_ocr_local_context') {
        const creator = args.p_user === c.creat_de && args.p_token === null
        const worker = args.p_user === null && tokenGood && args.p_token === TOKEN
        return ok(args.p_id === ID && (creator || worker) ? [{ ...c }] : [])
      }
      if (fn === 'fn_ocr_local_admite') { assert.equal(args.p_user, USER); assert.ok(events.includes('caller:profiles')); return ok([{ id: ID, cale: 'ocr-local-cereri/' + ID + '.pdf', status: admitted, motiv: admissionError }]) }
      if (fn === 'fn_ocr_local_confirma_upload') return ok([{ termen_local: '2099-01-01T00:00:00Z' }])
      if (fn === 'fn_ocr_local_verifica_token') return tokenGood && args.p_token === TOKEN ? ok([{ cale: `ocr-local-cereri/${ID}.pdf`, sablon: c.sablon, termen_local: '2099-01-01T00:00:00Z' }]) : fail('token_invalid')
      if (fn === 'fn_ocr_local_drept_platit') {
        const acordat = !paid
        if (acordat) { paid = true; c.drept_platit_de = args.p_ramura as 'fallback' | 'arbitraj'; c.apel_faza = 'acordat'; if (args.p_ramura === 'fallback') rowState = 'fallback' }
        return ok([{ acordat, stare: rowState, drept_platit_de: c.drept_platit_de, apel_faza: c.apel_faza, proiect: c.proiect_id, user: USER, sablon: c.sablon, cale: `ocr-local-cereri/${ID}.pdf` }])
      }
      if (fn === 'fn_ocr_local_rezerva_apel') {
        if (quota) { c.apel_faza = 'esuat_inainte'; return ok([{ acordat: false, rezervare_id: null, status: 'plafon_depasit' }]) }
        if (c.apel_faza !== 'acordat') return ok([{ acordat: false, status: c.apel_faza }])
        c.apel_faza = 'rezervat'; c.rezervare_id = 7
        return ok([{ acordat: true, rezervare_id: 7, status: 'rezervat' }])
      }
      if (fn === 'fn_ocr_local_apel_faza') {
        c.apel_faza = String(args.p_faza)
        if (args.p_faza === 'raspuns') c.apel_raspuns = args.p_raspuns as Record<string, unknown>
        if (args.p_faza === 'esuat_inainte') c.cost_usd = 0
        if (args.p_faza === 'esuat_dupa') c.cost_usd = .05
        if (args.p_faza === 'decontat') c.cost_usd = Number(args.p_cost)
        return ok(null)
      }
      if (fn === 'fn_ocr_local_stare') return args.p_user !== USER ? fail('nu_exista') : ok([{ stare: rowState, rezultat: rowState === 'gata' ? c.apel_raspuns : null, ramura: 'locala', eroare: null, termen_local: '2099-01-01T00:00:00Z', termen_fallback: null, token_executie: 'INTERZIS' }])
      if (fn === 'fn_ocr_local_preia') return ok([{ id: ID, token: TOKEN, sablon: c.sablon, sha: 'a'.repeat(64), termen_local: '2099-01-01T00:00:00Z', cale: 'INTERZIS' }])
      if (fn === 'fn_ocr_local_rezultat') { rowState = args.p_eroare ? 'esuata' : 'gata'; return ok(null) }
      if (fn === 'fn_ocr_local_inchide_fallback') { rowState = args.p_eroare ? 'esuata' : 'gata'; return ok(null) }
      if (fn === 'fn_ocr_local_heartbeat') return ok(null)
      throw new Error('RPC neprevăzut ' + fn)
    },
    storage: { from: (bucket: string) => {
      assert.equal(bucket, 'ocr-local-cereri')
      return {
        upload: async () => { events.push('upload'); return { error: uploadError ? {} : null } },
        download: async (cale: string) => { events.push('download'); assert.equal(cale, `ocr-local-cereri/${ID}.pdf`); return { data: new Blob(['%PDF-test']), error: null } },
        createSignedUrl: async (cale: string, sec: number) => { events.push('link'); assert.equal(cale, `ocr-local-cereri/${ID}.pdf`); assert.equal(sec, 120); return { data: { signedUrl: 'https://test.invalid/signed' }, error: null } },
      }
    } },
  } as unknown as Client
  const d = { caller, ledger, apiKey: 'fake', pdf: async () => 'mono' as const }
  const call = (body: Record<string, unknown>, worker = false, headers: Record<string, string> = {}) => handle(new Request('https://test.invalid', { method: 'POST', headers: { ...(worker ? { [ANTET_IZO_OCR]: secret } : { Authorization: 'Bearer fake' }), ...headers }, body: JSON.stringify(body) }), d)
  return { c, d, events, calls, call, set: (v: Record<string, unknown>) => {
    admitted = String(v.admitted ?? admitted); admissionError = String(v.admissionError ?? admissionError)
    owner = Boolean(v.owner ?? owner); access = Boolean(v.access ?? access); expired = Boolean(v.expired ?? expired); jwt = Boolean(v.jwt ?? jwt)
    goodSecret = Boolean(v.goodSecret ?? goodSecret); tokenGood = Boolean(v.tokenGood ?? tokenGood); uploadError = Boolean(v.uploadError ?? uploadError); quota = Boolean(v.quota ?? quota)
  } }
}
const cere = () => ({ op: 'cere', proiect_id: 1, depozit_id: 2, sablon: 'aviz_teava', pdf_base64: btoa('%PDF-test') })
const rezultat = (obiect: unknown = brut(), eroare: string | null = null) => ({ op: 'rezultat', cerere_id: ID, token: TOKEN, obiect, eroare, sursa: { perspectiva: 'inutila', dezacorduri: 0, secunde: 1 } })
const arb = () => ({ op: 'arbitreaza', cerere_id: ID, token: TOKEN, rotatie_grade: 0, celule })

Deno.test('canale închise: secret lipsă/greșit, JWT la worker, secret la UI; fără fallback de secret', async () => {
  for (const header of ['', 'b'.repeat(64), 'invalid']) {
    const f = fixture(), r = await f.call({ op: 'preia', worker_id: 'w' }, true, { [ANTET_IZO_OCR]: header })
    assert.equal(r.status, 401); assert.equal(f.events.includes('fn_ocr_local_preia'), false)
  }
  const f = fixture()
  assert.equal((await f.call({ op: 'preia', worker_id: 'w' })).status, 401)
  assert.equal((await f.call(cere(), false, { [ANTET_IZO_OCR]: secret })).status, 401)
  assert.equal((await f.call({ op: 'curata' }, true)).status, 400)
  assert.equal((await f.call({ op: 'toString' }, true)).status, 400)
})
Deno.test('creator și drepturi expirate: numai lookup context înainte de poartă, fără RPC de coadă', async () => {
  for (const op of ['stare', 'fallback']) {
    const f = fixture(); f.c.creat_de = 'altul'
    assert.equal((await f.call({ op, cerere_id: ID })).status, 404)
    assert.deepEqual(f.calls.map(c => c.fn), ['fn_ocr_local_context'])
    assert.equal(f.events.includes('caller:profiles'), false)
  }
  const f = fixture(); f.set({ owner: false, expired: true })
  assert.equal((await f.call({ op: 'fallback', cerere_id: ID })).status, 403)
  assert.deepEqual(f.calls.map(c => c.fn), ['fn_ocr_local_context'])
  const g = fixture(); g.set({ owner: false, access: false })
  assert.equal((await g.call(cere())).status, 403); assert.equal(g.calls.length, 0)
})
Deno.test('stare: context din server, p_user din getUser, proiecție fără token/faze', async () => {
  const f = fixture(), r = await f.call({ op: 'stare', cerere_id: ID })
  assert.equal(r.status, 200)
  assert.deepEqual(Object.keys(await r.json()).sort(), ['success', 'stare', 'ramura', 'rezultat', 'eroare', 'termen_local', 'termen_fallback'].sort())
  assert.equal(f.calls[0].args.p_user, USER)
  assert.deepEqual(f.calls[0], { fn: 'fn_ocr_local_context', args: { p_id: ID, p_user: USER, p_token: null } })
  assert.ok(f.events.indexOf('jwt') < f.events.indexOf('fn_ocr_local_context'))
  assert.ok(f.events.indexOf('fn_ocr_local_context') < f.events.indexOf('caller:profiles'))
  assert.ok(f.events.indexOf('caller:profiles') < f.events.indexOf('fn_ocr_local_stare'))
  assert.equal((await f.call({ op: 'stare', cerere_id: ID, user: USER })).status, 400)
})
Deno.test('JWT invalid: niciun context/RPC; context din body refuzat; lookup eșuat închide accesul', async () => {
  for (const op of ['cere', 'stare', 'fallback']) {
    const f = fixture(); f.set({ jwt: false })
    const r = await f.call(op === 'cere' ? cere() : { op, cerere_id: ID })
    assert.equal(r.status, 403); assert.equal(f.calls.length, 0)
  }
  for (const op of ['stare', 'fallback']) {
    const f = fixture()
    assert.equal((await f.call({ op, cerere_id: ID, proiect_id: 1, depozit_id: 2, token: TOKEN })).status, 400)
    assert.equal(f.calls.length, 0)
    f.d.ledger.rpc = (() => Promise.resolve({ data: null, error: { message: 'permission denied' } })) as typeof f.d.ledger.rpc
    const r = await f.call({ op, cerere_id: ID })
    assert.equal(r.status, 503); assert.equal((await r.json()).eroare, 'coada_indisponibila')
    assert.equal(f.events.includes('caller:profiles'), false)
  }
})
Deno.test('admiterea/cota preced Storage; multipagină, invalid, neverificabil nu urcă nimic', async () => {
  for (const motiv of ['limita_active', 'limita_ora', 'limita_zi', 'limita_incercari', 'local_indisponibil', 'noapte']) {
    const f = fixture(); f.set({ admitted: 'refuzata', admissionError: motiv })
    const r = await f.call(cere()); assert.equal(r.status, motiv.startsWith('limita_') ? 429 : 409)
    assert.equal(f.events.includes('upload'), false)
  }
  for (const [verdict, status, code] of [['multi', 409, 'multipagina'], ['invalid', 422, 'pdf_invalid'], ['neverificabil', 409, 'verificare_indisponibila']] as const) {
    const f = fixture(), r = await handle(new Request('https://test.invalid', { method: 'POST', headers: { Authorization: 'Bearer fake' }, body: JSON.stringify(cere()) }), { ...f.d, pdf: async () => verdict })
    assert.equal(r.status, status); assert.equal((await r.json()).eroare, code)
    assert.equal(f.events.includes('upload'), false)
  }
  const f = fixture(); assert.equal((await f.call(cere())).status, 200)
  assert.ok(f.events.indexOf('fn_ocr_local_admite') < f.events.indexOf('upload'))
  assert.ok(f.events.indexOf('upload') < f.events.indexOf('fn_ocr_local_confirma_upload'))
  const g = fixture(); g.set({ uploadError: true }); assert.equal((await g.call(cere())).status, 503)
  assert.equal(g.events.includes('fn_ocr_local_confirma_upload'), false)
})
Deno.test('link: cale arbitrară refuzată, token vechi refuzat; cale numai din B1', async () => {
  const f = fixture()
  assert.equal((await f.call({ op: 'link', cerere_id: ID, token: TOKEN, cale: 'arbitrar' }, true)).status, 400)
  assert.equal(f.events.includes('link'), false)
  f.set({ tokenGood: false })
  assert.equal((await f.call({ op: 'link', cerere_id: ID, token: TOKEN }, true)).status, 409)
  assert.equal(f.events.includes('link'), false)
  f.set({ tokenGood: true }); assert.equal((await f.call({ op: 'link', cerere_id: ID, token: TOKEN }, true)).status, 200)
})
Deno.test('rezultat: validare strictă brută, structură finală, ramură eroare fără normalizare', async () => {
  const f = fixture(); assert.equal((await f.call(rezultat(), true)).status, 200)
  const saved = f.calls.find(c => c.fn === 'fn_ocr_local_rezultat')!.args.p_rezultat as Record<string, unknown>
  assert.deepEqual(Object.keys(saved).sort(), ['success', 'tip', 'sablon', 'antet', 'randuri', 'rotatie_grade', 'totaluri_tiparite', 'avertismente', 'model', 'cost_usd', 'plafon', 'sursa'].sort())
  for (const mutate of [(o: ReturnType<typeof brut>) => { o.randuri[0].nr_crt = 1 as unknown as string }, (o: ReturnType<typeof brut>) => { Object.assign(o, { extra: true }) }]) {
    const g = fixture(), o = brut(); mutate(o)
    assert.equal((await g.call(rezultat(o), true)).status, 400)
    assert.equal(g.calls.at(-1)!.args.p_eroare, 'raspuns_local_invalid')
  }
  const g = fixture(); assert.equal((await g.call(rezultat(null, 'garda'), true)).status, 200)
  assert.equal(g.events.includes('fn_ocr_local_context'), false)
  const h = fixture(); h.set({ tokenGood: false })
  assert.equal((await h.call(rezultat(), true)).status, 409)
  assert.equal(h.events.includes('fn_ocr_local_rezultat'), false)
})
Deno.test('arbitraj: numai câmpuri nestructurale, exact setul și tipurile, fără dubluri', () => {
  for (const cs of [[{ ...celule[0], camp: 'serie' }], [...celule, ...celule], [{ ...celule[0], lighton: 1 }], [{ ...celule[0], rand: 201 }], [{ ...celule[0], extra: 1 }]]) assert.throws(() => valideazaCelule(cs, 'aviz_teava'))
  assert.equal(valideazaCelule(celule, 'aviz_teava').length, 1)
  const d = { rand: 1, camp: 'lungime_doc', valoare: '12.50', sigur: true }
  for (const v of [{ celule: [] }, { celule: [d, d] }, { celule: [{ ...d, camp: 'serie' }] }, { celule: [{ ...d, sigur: 'true' }] }, { celule: [{ ...d, valoare: 12.5 }] }, { celule: [d], extra: 1 }]) assert.throws(() => valideazaDecizii(v, celule))
  assert.equal(valideazaDecizii({ celule: [d] }, celule).arbitraj, 'ok')
})

function transport(o: { timeout?: boolean; countError?: boolean; jsonInvalid?: boolean; truncated?: boolean; noUsage?: boolean } = {}, events: string[] = []) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const count = String(url).endsWith('count_tokens'), payload = JSON.parse(String(init!.body))
    events.push(count ? 'count' : 'send')
    assert.equal(payload.model, 'claude-haiku-5-5')
    if (count) return o.countError ? new Response('', { status: 503 }) : Response.json({ input_tokens: 1000 })
    if (o.timeout) throw new DOMException('timeout', 'TimeoutError')
    return Response.json({ usage: o.noUsage ? undefined : { input_tokens: 1000, output_tokens: 100 }, stop_reason: o.truncated ? 'max_tokens' : 'end_turn', content: [{ type: 'text', text: o.jsonInvalid ? '{' : JSON.stringify({ celule: [{ rand: 1, camp: 'lungime_doc', valoare: '12.50', sigur: true }] }) }] })
  }) as typeof fetch
}
const paid = (f: ReturnType<typeof fixture>, t: typeof fetch) => apelPlatitE3({ client: f.d.ledger, id: ID, ramura: 'arbitraj', token: TOKEN, user: null, apiKey: 'fake', maxTokens: 260, mesaj: async () => ({ messages: [] }), valida: async raw => valideazaDecizii(JSON.parse(raw), celule), transport: t })
Deno.test('plafon refuzat: nicio numărare, generare sau Storage', async () => {
  const f = fixture(); f.set({ quota: true }); const sends: string[] = []
  assert.deepEqual(await paid(f, transport({}, sends)), { tip: 'eroare', cod: 'plafon_depasit' })
  assert.deepEqual(sends, []); assert.equal(f.events.includes('download'), false)
})
Deno.test('timeout după send păstrează costul; count indisponibil eliberează 0', async () => {
  for (const [options, phase, cost] of [[{ timeout: true }, 'esuat_dupa', .05], [{ countError: true }, 'esuat_inainte', 0]] as const) {
    const f = fixture(), sent: string[] = []
    await paid(f, transport(options, sent))
    assert.equal(f.c.apel_faza, phase); assert.equal(f.c.cost_usd, cost)
    assert.equal(sent.filter(s => s === 'send').length, options.timeout ? 1 : 0)
    await paid(f, transport(options, sent)); assert.equal(sent.filter(s => s === 'send').length, options.timeout ? 1 : 0)
  }
})
Deno.test('JSON invalid/trunchiat: invalid persistat înainte de decontat; usage absent lasă recovery conservator', async () => {
  for (const opt of [{ jsonInvalid: true }, { truncated: true }]) {
    const f = fixture(); assert.equal((await paid(f, transport(opt))).tip, 'eroare')
    assert.equal(f.c.apel_raspuns!.invalid, true); assert.equal(f.c.apel_faza, 'decontat'); assert.ok(f.c.cost_usd! > 0)
    const phases = f.calls.filter(c => c.fn === 'fn_ocr_local_apel_faza').map(c => c.args.p_faza)
    assert.deepEqual(phases, ['trimis', 'raspuns', 'decontat'])
  }
  const f = fixture(); await paid(f, transport({ noUsage: true })); assert.equal(f.c.apel_faza, 'raspuns'); assert.equal(f.c.cost_usd, null)
})
Deno.test('arbitraj repetat / fallback după arbitraj / concurență: maximum un messages', async () => {
  const f = fixture(), sent: string[] = []
  f.d = Object.assign(f.d, { transport: transport({}, sent) })
  assert.equal((await f.call(arb(), true)).status, 200)
  const replay = await f.call(arb(), true); assert.equal((await replay.json()).arbitraj, 'ok')
  assert.deepEqual(f.calls.find(c => c.fn === 'fn_ocr_local_context')!.args, { p_id: ID, p_user: null, p_token: TOKEN })
  assert.equal(f.events.includes('jwt'), false)
  assert.equal(f.events.includes('caller:profiles'), false)
  await f.call({ op: 'fallback', cerere_id: ID })
  assert.equal(sent.filter(s => s === 'send').length, 1)
  const g = fixture(), concurrent: string[] = []
  Object.assign(g.d, { transport: transport({}, concurrent) })
  await Promise.all([g.call(arb(), true), g.call({ op: 'fallback', cerere_id: ID })])
  assert.ok(concurrent.filter(s => s === 'send').length <= 1)
})
Deno.test('context worker dispărut între verificarea tokenului și recuperare: fără răspuns arbitrat sau rezultat salvat', async () => {
  for (const op of ['arbitreaza', 'rezultat']) {
    const f = fixture(), sent: string[] = []
    Object.assign(f.d, { transport: transport({}, sent) })
    if (op === 'arbitreaza') await f.call(arb(), true)
    const original = f.d.ledger.rpc.bind(f.d.ledger)
    f.d.ledger.rpc = ((fn: string, args: Record<string, unknown>) => fn === 'fn_ocr_local_context'
      ? Promise.resolve({ data: [], error: null }) : original(fn, args)) as typeof f.d.ledger.rpc
    const r = await f.call(op === 'arbitreaza' ? arb() : rezultat(), true)
    if (op === 'arbitreaza') {
      assert.deepEqual(await r.json(), { arbitraj: 'deja_consumat' })
      assert.equal(sent.filter(s => s === 'send').length, 1)
    } else {
      assert.equal(r.status, 409)
      assert.equal(f.events.includes('fn_ocr_local_rezultat'), false)
    }
  }
})
Deno.test('fallback integral: format aviz_e3 persistat, creator din JWT, repetare fără alt apel', async () => {
  const f = fixture(), sent: string[] = []
  const t = (async (url: string | URL | Request) => {
    if (String(url).endsWith('count_tokens')) return Response.json({ input_tokens: 1000 })
    sent.push('send')
    return Response.json({ usage: { input_tokens: 1000, output_tokens: 100 }, stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(brut()) }] })
  }) as typeof fetch
  Object.assign(f.d, { transport: t })
  const r = await f.call({ op: 'fallback', cerere_id: ID })
  assert.equal(r.status, 200)
  const b = await r.json(); assert.equal(b.tip, 'aviz_e3'); assert.equal(b.cerere_id, ID)
  assert.equal(b.randuri[0].lungime_doc, 12.5); assert.equal(b.randuri[0].greutate_kg, 1343)
  const persist = f.calls.find(c => c.fn === 'fn_ocr_local_inchide_fallback')!
  assert.deepEqual(persist.args.p_rezultat, f.c.apel_raspuns)
  assert.equal(f.calls.find(c => c.fn === 'fn_ocr_local_drept_platit')!.args.p_user, USER)
  const replay = await f.call({ op: 'fallback', cerere_id: ID }); assert.equal(replay.status, 200)
  assert.equal(sent.length, 1)
})
Deno.test('fallback în curs: eroare in_curs nu este suprascrisă de eroare=null din status', async () => {
  const f = fixture()
  await paid(f, transport({ noUsage: true }))
  const r = await f.call({ op: 'fallback', cerere_id: ID })
  assert.equal(r.status, 409); assert.equal((await r.json()).eroare, 'in_curs')
})
Deno.test('ACK pierdut la trimis și la răspuns: nu se retrimite HTTP; recovery păstrează răspunsul', async () => {
  for (const phase of ['trimis', 'raspuns', 'decontat']) {
    const f = fixture(), sent: string[] = [], original = f.d.ledger.rpc.bind(f.d.ledger)
    f.d.ledger.rpc = ((fn: string, args: Record<string, unknown>) => {
      const pending = original(fn, args)
      if (fn === 'fn_ocr_local_apel_faza' && args.p_faza === phase) return Promise.resolve(pending).then(() => { throw new Error('ACK pierdut') })
      return pending
    }) as typeof f.d.ledger.rpc
    await paid(f, transport({}, sent)); await paid(f, transport({}, sent))
    assert.equal(sent.filter(s => s === 'send').length, phase === 'trimis' ? 0 : 1)
    assert.equal(f.events.includes('fn_ai_plafon_rezerva'), false)
  }
})
Deno.test('structură: cantități invalide, serie goală, nr duplicat blochează înainte de prefill', () => {
  for (const cantitate of [null, 0, 1.5, 2]) {
    const o = brut('lista_curbe'); o.randuri[0].cantitate = cantitate as unknown as string
    assert.throws(() => validaStructuraE3(normalizeazaE3(JSON.stringify(o), 'lista_curbe'), 'lista_curbe'))
  }
  for (const change of [(o: ReturnType<typeof brut>) => { o.randuri[0].serie = '' }, (o: ReturnType<typeof brut>) => { o.randuri.push({ ...o.randuri[0], serie: '002' }) }]) {
    const o = brut(); change(o); assert.throws(() => validaStructuraE3(normalizeazaE3(JSON.stringify(o), 'aviz_teava'), 'aviz_teava'))
  }
})
Deno.test('normalizare/prefill/RPC: metri, mm, kg și zero inițial păstrate', () => {
  for (const s of ['aviz_teava', 'lista_curbe'] as const) {
    const o = brut(s); valideazaBrutLocalE3(o, s)
    const p = normalizeazaE3(JSON.stringify(o), s); validaStructuraE3(p, s)
    const editorSablon = s === 'aviz_teava' ? s : 'lista_ambalare_curbe'
    const ed = aplicaPropunereOCR({ sablon: editorSablon, antet: {}, randuri: [] }, p)
    const r = randNormalizat(ed.randuri[0], editorSablon)
    assert.equal(r.serie, '001'); assert.equal(r.greutate_kg, 1343)
    assert.equal(r.perete_mm, 8.8)
    if (s === 'aviz_teava') assert.equal(r.lungime_doc_mm, 12500)
  }
})

Deno.test('fixture-uri brute B3 reale: schema → normalizare → prefill → randNormalizat', async () => {
  for (const [file, s] of [['payload_aviz_comtech_26091505.json', 'aviz_teava'], ['payload_lista_gurgenler_truck164.json', 'lista_curbe']] as const) {
    const raw = JSON.parse(await readFile(new URL(`./fixtures/${file}`, import.meta.url), 'utf8'))
    valideazaBrutLocalE3(raw, s)
    const p = normalizeazaE3(JSON.stringify(raw), s); validaStructuraE3(p, s)
    const editorSablon = s === 'aviz_teava' ? s : 'lista_ambalare_curbe'
    const ed = aplicaPropunereOCR({ sablon: editorSablon, antet: {}, randuri: [] }, p)
    assert.equal(ed.randuri.length, raw.randuri.length)
    const mapped = ed.randuri.map((r: Record<string, unknown>) => randNormalizat(r, editorSablon))
    for (const [i, row] of mapped.entries()) {
      assert.equal(row.serie, raw.randuri[i].serie.trim())
      if (s === 'aviz_teava') assert.equal(row.lungime_doc_mm, Math.round(Number(p.randuri[i].lungime_doc) * 1000))
      if (s === 'lista_curbe') {
        assert.equal(row.net_kg, p.randuri[i].net_kg)
        assert.equal(row.brut_kg, p.randuri[i].brut_kg)
      }
    }
    if (s === 'aviz_teava') assert.ok(mapped.some((r: Record<string, unknown>) => r.greutate_kg === 1343))
    else assert.equal(Number(ed.antet.total_net_kg), 9920)
  }
})
