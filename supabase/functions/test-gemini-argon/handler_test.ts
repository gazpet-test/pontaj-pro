// deno test --no-check --allow-read supabase/functions/test-gemini-argon/handler_test.ts
// Fără rețea: fetch-ul spre Google e simulat; clientul Supabase e fake_supa.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, cerereH, fakeSupa, getUser, JWT_FALS_SERVICE, OWNER, PROFILE, STRAIN } from '../_test/fake_supa.ts'
import { cost, handler, MAX_FISIER, MAX_OUTPUT, MAX_PROMPT, tarif } from './handler.ts'

const DOCS = [{ id: 7, fisier_path: 'lic95/plansa_PS01.png' }, { id: 8, fisier_path: 'lic95/caiet.pdf' }]
const RASPUNS = {
  candidates: [{ content: { parts: [{ text: 'gând', thought: true }, { text: 'Răspuns: 42' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 1000, cachedContentTokenCount: 0, candidatesTokenCount: 200, thoughtsTokenCount: 300 },
}

function pregateste(opt: { http?: number; corp?: unknown; arunca?: Error; fisier?: Uint8Array; cheie?: string; chei?: { A?: string; O?: string } } = {}) {
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_documente_atribuire: DOCS })
  const fisier = opt.fisier ?? new Uint8Array([1, 2, 3, 4])
  ;(supa as any).storage = { from: () => ({ download: () => { n.storage++; return Promise.resolve({ data: new Blob([fisier]), error: null }) } }) }
  const trimise: { url: string; init: any }[] = []
  const f = ((url: string, init: any) => {
    n.ai++; trimise.push({ url, init })
    if (opt.arunca) return Promise.reject(opt.arunca)
    return Promise.resolve(new Response(JSON.stringify(opt.corp ?? RASPUNS), { status: opt.http ?? 200 }))
  }) as unknown as typeof fetch
  const deps = { db: supa, getUser, fetch: f, cheie: opt.cheie ?? 'cheie-test', chei: opt.chei ?? { A: 'cheie-a', O: 'cheie-o' }, acum: () => new Date('2026-10-20T10:00:00Z') }
  return { deps, n, trimise }
}
const ruleaza = async (req: Request, p = pregateste()) => {
  const r = await handler(req, p.deps)
  return { status: r.status, j: JSON.parse(await r.text()), ...p }
}
const zeroCost = (n: any) => { assertEquals(n.ai, 0, 'AI'); assertEquals(n.storage, 0, 'storage'); assertEquals(n.scrieri, 0, 'scrieri') }
const TEXT = { task: 'text', input: { prompt: 'Cât face 6*7?' } }

// --- poarta de rol ---
Deno.test('argon: fără Authorization -> 401, zero cost', async () => {
  const r = await ruleaza(cerereH({}, TEXT)); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('argon: cheia anon / JWT fără utilizator -> 401, zero cost', async () => {
  // getUser simulat: orice token în formă JWT nevalidat de Auth => null (cheia anon nu are user)
  const r = await ruleaza(cerereH({ Authorization: 'Bearer eyJhbGciOi.anon.semnatura' }, TEXT)); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('argon: JWT fals care pretinde service_role -> 401, zero cost', async () => {
  const r = await ruleaza(cerereH({ Authorization: `Bearer ${JWT_FALS_SERVICE}` }, TEXT)); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('argon: utilizator autentificat dar NU owner -> 403, zero cost', async () => {
  const r = await ruleaza(cerere(STRAIN, TEXT)); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('argon: utilizator fără profil -> 403, zero cost', async () => {
  const r = await ruleaza(cerere('u-necunoscut', TEXT)); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('argon: cheie lipsă -> 500 JSON, fără apel', async () => {
  const r = await ruleaza(cerere(OWNER, TEXT), pregateste({ cheie: '' })); assertEquals(r.status, 500); zeroCost(r.n)
})

// --- validarea intrării ---
Deno.test('argon: task în afara listei -> 400, zero cost', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'audio', input: { prompt: 'x' } })); assertEquals(r.status, 400); zeroCost(r.n)
})
Deno.test('argon: prompt lipsă / prea lung -> 400 / 413', async () => {
  const a = await ruleaza(cerere(OWNER, { task: 'text', input: {} })); assertEquals(a.status, 400); zeroCost(a.n)
  const b = await ruleaza(cerere(OWNER, { task: 'text', input: { prompt: 'x'.repeat(MAX_PROMPT + 1) } })); assertEquals(b.status, 413); zeroCost(b.n)
})
Deno.test('argon: max_output peste plafon sau thinking invalid -> 400', async () => {
  const a = await ruleaza(cerere(OWNER, { ...TEXT, max_output: MAX_OUTPUT + 1 })); assertEquals(a.status, 400); zeroCost(a.n)
  const b = await ruleaza(cerere(OWNER, { ...TEXT, thinking: 'minimal' })); assertEquals(b.status, 400); zeroCost(b.n)
})
Deno.test('argon: cale care NU e document de atribuire -> 403, fără descărcare', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'pdf', input: { prompt: 'x', cale: 'hr/ci_angajat.pdf' } }))
  assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('argon: cale cu .. -> 400', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'pdf', input: { prompt: 'x', cale: 'lic95/../hr/a.pdf' } })); assertEquals(r.status, 400); zeroCost(r.n)
})
Deno.test('argon: payload base64 peste plafon -> 413, fără apel', async () => {
  const mare = 'A'.repeat(Math.ceil(MAX_FISIER * 4 / 3) + 8)
  const r = await ruleaza(cerere(OWNER, { task: 'imagine', input: { prompt: 'x', date_b64: mare, mime: 'image/png' } }))
  assertEquals(r.status, 413); zeroCost(r.n)
})
Deno.test('argon: fișier din storage peste plafon -> 413, fără apel AI', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'pdf', input: { prompt: 'x', cale: 'lic95/caiet.pdf' } }), pregateste({ fisier: new Uint8Array(MAX_FISIER + 1) }))
  assertEquals(r.status, 413); assertEquals(r.n.ai, 0)
})
Deno.test('argon: mime nepermis pentru imagine -> 400', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'imagine', input: { prompt: 'x', date_b64: 'AAAA', mime: 'image/gif' } })); assertEquals(r.status, 400); zeroCost(r.n)
})

// --- calea fericită ---
Deno.test('argon: owner text -> răspuns, usage, cost, jurnal; fără gânduri în text; cheia în antet', async () => {
  const r = await ruleaza(cerere(OWNER, TEXT))
  assertEquals(r.status, 200); assertEquals(r.j.ok, true)
  assertEquals(r.j.text, 'Răspuns: 42')
  assertEquals(r.j.usage, { prompt: 1000, cached: 0, candidates: 200, thoughts: 300 })
  assertEquals(r.j.cost_usd, 0.007) // 1000*2/1e6 + 500*10/1e6
  assertEquals(r.n.ai, 1); assertEquals(r.n.scrieri, 1); assert(r.n.citiri.includes('ai_usage_log'))
  const t = r.trimise[0]
  assert(t.url.includes('/models/gemini-4-argon:generateContent'))
  assert(!t.url.includes('key='), 'cheia nu are voie în URL')
  assertEquals(t.init.headers['x-goog-api-key'], 'cheie-test')
  const corp = JSON.parse(t.init.body)
  assertEquals(corp.generationConfig.thinkingConfig.thinkingLevel, 'low')
  assertEquals(corp.generationConfig.maxOutputTokens, 8192)
  assertEquals(corp.generationConfig.temperature, undefined)
})
Deno.test('argon: owner imagine din document de atribuire -> inlineData png + sursa', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'imagine', input: { prompt: 'Citește indicatorul', cale: 'lic95/plansa_PS01.png' }, thinking: 'medium' }))
  assertEquals(r.status, 200); assertEquals(r.j.sursa, 'ofertare_documente_atribuire#7')
  const corp = JSON.parse(r.trimise[0].init.body)
  assertEquals(corp.contents[0].parts[0].inlineData.mimeType, 'image/png')
  assertEquals(corp.contents[0].parts[0].inlineData.data, btoa(String.fromCharCode(1, 2, 3, 4)))
  assertEquals(corp.generationConfig.thinkingConfig.thinkingLevel, 'medium')
})
Deno.test('argon: owner pdf payload de test -> application/pdf', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'pdf', input: { prompt: 'x', date_b64: 'JVBERi0=' } }))
  assertEquals(r.status, 200); assertEquals(r.j.sursa, 'payload_test')
  assertEquals(JSON.parse(r.trimise[0].init.body).contents[0].parts[0].inlineData.mimeType, 'application/pdf')
})

// --- erori întoarse ca JSON, nu aruncate ---
Deno.test('argon: eroare HTTP Google -> JSON ok:false, fără jurnal', async () => {
  const r = await ruleaza(cerere(OWNER, TEXT), pregateste({ http: 400, corp: { error: { message: 'thinking_budget not supported' } } }))
  assertEquals(r.status, 200); assertEquals(r.j.ok, false); assertEquals(r.j.http, 400)
  assert(String(r.j.error).includes('thinking_budget')); assertEquals(r.n.scrieri, 0)
})
Deno.test('argon: excepție de rețea -> JSON ok:false, fără throw', async () => {
  const r = await ruleaza(cerere(OWNER, TEXT), pregateste({ arunca: new Error('ECONNRESET') }))
  assertEquals(r.status, 200); assertEquals(r.j.ok, false); assert(String(r.j.error).includes('ECONNRESET'))
})
Deno.test('argon: timeout (AbortError) -> mesaj timeout', async () => {
  const e = new Error('aborted'); e.name = 'AbortError'
  const r = await ruleaza(cerere(OWNER, TEXT), pregateste({ arunca: e }))
  assertEquals(r.j.ok, false); assert(String(r.j.error).includes('timeout'))
})
Deno.test('argon: body invalid -> 400', async () => {
  const req = new Request('http://x/', { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` }, body: 'nu-json' })
  const r = await ruleaza(req); assertEquals(r.status, 400); zeroCost(r.n)
})

// --- tarif ---
Deno.test('argon: tarif se dublează la 1.12.2026; cache-ul implicit e la 5%', () => {
  assertEquals(tarif(new Date('2026-11-30T23:59:00Z')).in * 1e6, 2)
  assertEquals(tarif(new Date('2026-12-01T00:00:00Z')).out * 1e6, 20)
  assertEquals(cost({ prompt: 1_000_000, cached: 0, candidates: 0, thoughts: 0 }, new Date('2026-10-15')), 2)
  assertEquals(cost({ prompt: 1_000_000, cached: 1_000_000, candidates: 0, thoughts: 0 }, new Date('2026-10-15')), 0.1)
  assertEquals(cost({ prompt: 0, cached: 0, candidates: 500_000, thoughts: 500_000 }, new Date('2026-12-02')), 20)
})

// --- comparatori (setul „test de inteligență”, doar text) ---
Deno.test('argon: comparator pe imagine/pdf -> 400, zero cost', async () => {
  const r = await ruleaza(cerere(OWNER, { task: 'imagine', model: 'sonnet-5', input: { prompt: 'x', date_b64: 'AAAA', mime: 'image/png' } }))
  assertEquals(r.status, 400); zeroCost(r.n)
})
Deno.test('argon: model necunoscut -> 400, zero cost', async () => {
  const r = await ruleaza(cerere(OWNER, { ...TEXT, model: 'claude-opus-5' })); assertEquals(r.status, 400); zeroCost(r.n)
})
Deno.test('argon: comparator fără cheie -> 500, zero cost', async () => {
  const r = await ruleaza(cerere(OWNER, { ...TEXT, model: 'gpt-5-mini' }), pregateste({ chei: { A: 'a' } })); assertEquals(r.status, 500); zeroCost(r.n)
})
Deno.test('argon: comparator tot în spatele porții de owner', async () => {
  const r = await ruleaza(cerere(STRAIN, { ...TEXT, model: 'haiku-5-5' })); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('argon: sonnet-5 -> Messages API, effort = thinking, cost 2/10', async () => {
  const corp = { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '42' }], usage: { input_tokens: 1000, output_tokens: 500 }, stop_reason: 'end_turn' }
  const r = await ruleaza(cerere(OWNER, { ...TEXT, model: 'sonnet-5', thinking: 'medium' }), pregateste({ corp }))
  assertEquals(r.status, 200); assertEquals(r.j.model, 'claude-sonnet-5'); assertEquals(r.j.text, '42')
  assertEquals(r.j.cost_usd, 0.007) // 1000*2/1e6 + 500*10/1e6
  const t = r.trimise[0]; assert(t.url.includes('api.anthropic.com/v1/messages'))
  const b = JSON.parse(t.init.body); assertEquals(b.output_config.effort, 'medium'); assertEquals(b.temperature, undefined)
  assertEquals(r.n.scrieri, 1)
})
Deno.test('argon: gpt-5-mini -> Responses API, reasoning.effort, cost 0.25/2', async () => {
  const corp = { output_text: '42', usage: { input_tokens: 1000, output_tokens: 1000 }, status: 'completed' }
  const r = await ruleaza(cerere(OWNER, { ...TEXT, model: 'gpt-5-mini' }), pregateste({ corp }))
  assertEquals(r.j.ok, true); assertEquals(r.j.text, '42'); assertEquals(r.j.cost_usd, 0.00225)
  assertEquals(JSON.parse(r.trimise[0].init.body).reasoning.effort, 'low')
})
Deno.test('argon: haiku-5-5 eroare HTTP -> JSON ok:false', async () => {
  const r = await ruleaza(cerere(OWNER, { ...TEXT, model: 'haiku-5-5' }), pregateste({ http: 429, corp: { error: { message: 'rate limit' } } }))
  assertEquals(r.j.ok, false); assertEquals(r.j.http, 429); assertEquals(r.n.scrieri, 0)
})
