// deno test supabase/functions/detect_plate_orphan_msgs/handler_test.ts
// Testul de handler (review PR #707): verifică la nivelul funcției întregi, nu doar al acces.ts, că nicio cerere fără drept
// — inclusiv cu vechiul antet intern de ocolire, cu orice valoare — nu citește mesaje/vehicule, nu descarcă poze, nu cheamă AI
// și nu scrie nimic. Dacă cineva reintroduce o cale care sare peste poartaPlate, testele „zero cost” pică.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { fakeFetch, fakeSupa } from '../_test/fake_supa.ts'
import { handler } from './handler.ts'

const OWNER = 'u-owner', ADMINL = 'u-adminl', ADMINL_FARA = 'u-adminl-fara-modul', SUPER = 'u-super', SANTIER = 'u-santier'
const PROFILES = [
  { id: OWNER, is_owner: true, role: 'superadmin' },
  { id: ADMINL, is_owner: false, role: 'admin_logistica' },
  { id: ADMINL_FARA, is_owner: false, role: 'admin_logistica' },
  { id: SUPER, is_owner: false, role: 'superadmin' },
  { id: SANTIER, is_owner: false, role: 'manager_santier' },
]
const UMA = [
  { profile_id: ADMINL, module: 'logistica' }, { profile_id: SUPER, module: 'logistica' },
  { profile_id: SANTIER, module: 'logistica' }, { profile_id: ADMINL_FARA, module: 'magazie' },
]
const ORFANE = [{ id: 1, status: 'pending_plate_detection', plate_detected: null, photo_path: 'x/1.jpg', msg_dt: '2026-10-02T06:34:33Z', autor: 'Sofer', caption_preview: '' }]
const BYPASS = 'X-Internal-MCP-Bypass'

// auth simulat: token „u-…” = utilizator real; orice altceva (cheia anon, JWT fals) = respins de Auth
const getUser = (jwt: string) => Promise.resolve(jwt.startsWith('u-')
  ? { data: { user: { id: jwt } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } })

// fake_supa comun + ce îi lipsește pentru funcția asta: auth.getUser, filtrul .is(), descărcare de poză reușită (opțional)
function mediu(o: { orfane?: unknown[]; cuPoza?: boolean } = {}) {
  const { supa, n } = fakeSupa({ profiles: PROFILES, user_module_access: UMA, whatsapp_messages_processed: (o.orfane ?? ORFANE) as any[], logistica_active: [] })
  const s = supa as any
  const from0 = s.from
  const usage: any[] = []
  s.from = (t: string) => {
    const b = from0(t), insert0 = b.insert
    b.is = () => b
    if (t === 'ai_usage_log') b.insert = (row: unknown) => { usage.push(row); return insert0(row) }
    return b
  }
  s.auth = { getUser }
  if (o.cuPoza) s.storage = { from: () => ({ download: () => { n.storage++; return Promise.resolve({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }) } }) }
  return { supa: s, n, usage }
}
// cheie: null = ANTHROPIC_API_KEY lipsă (un `undefined` explicit ar lua valoarea implicită 'k')
async function ruleaza(headers: Record<string, string>, m = mediu(), cheie: string | null = 'k') {
  const r = await handler(new Request('http://x/', { method: 'POST', headers }), () => ({ supa: m.supa, API_KEY: cheie ?? undefined, fetch: fakeFetch(m.n) }))
  return { status: r.status, corp: await r.json(), n: m.n, usage: m.usage }
}
// fabrică de dependențe care aruncă (ex. env lipsă la pornire) — numără de câte ori a fost chemată
function fabricaCareArunca() {
  const f = () => { f.chemari++; throw new Error('SUPABASE_URL lipsă') }
  f.chemari = 0
  return f
}
// refuz fără cost: nimic în afară de citirile porții (profiles, user_module_access), zero storage / AI / scrieri
function zeroCost(n: { ai: number; storage: number; scrieri: number; citiri: string[] }) {
  assertEquals(n.ai, 0, 'AI'); assertEquals(n.storage, 0, 'storage'); assertEquals(n.scrieri, 0, 'scrieri')
  const straine = n.citiri.filter((t) => t !== 'profiles' && t !== 'user_module_access')
  assertEquals(straine, [], 'citiri înaintea porții')
}

Deno.test('OPTIONS: 200, fără antetul de ocolire în CORS, zero citiri', async () => {
  const m = mediu()
  const r = await handler(new Request('http://x/', { method: 'OPTIONS' }), () => ({ supa: m.supa, API_KEY: 'k', fetch: fakeFetch(m.n) }))
  assertEquals(r.status, 200)
  assert(!(r.headers.get('Access-Control-Allow-Headers') || '').toLowerCase().includes('bypass'))
  assertEquals(m.n.citiri, [])
})

Deno.test('fabrica de dependențe aruncă: OPTIONS tot 200 cu CORS (fabrica nechemată), POST → 500 JSON cu CORS', async () => {
  const f1 = fabricaCareArunca()
  const o = await handler(new Request('http://x/', { method: 'OPTIONS' }), f1)
  assertEquals(o.status, 200); assertEquals(o.headers.get('Access-Control-Allow-Origin'), '*'); assertEquals(f1.chemari, 0)
  const f2 = fabricaCareArunca()
  const p = await handler(new Request('http://x/', { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` } }), f2)
  assertEquals(p.status, 500); assertEquals(f2.chemari, 1)
  assertEquals(p.headers.get('Access-Control-Allow-Origin'), '*')
  assert((p.headers.get('Content-Type') || '').includes('application/json'))
  assertEquals((await p.json()).error, 'SUPABASE_URL lipsă')
})

Deno.test('fără Authorization → 401 „Neautorizat”, zero cost', async () => {
  const r = await ruleaza({})
  assertEquals(r.status, 401); assertEquals(r.corp.error, 'Neautorizat'); zeroCost(r.n); assertEquals(r.n.citiri, [])
})

Deno.test('cheia anon / JWT fals → 401, zero cost', async () => {
  for (const t of ['eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.semnatura', 'invalid']) {
    const r = await ruleaza({ Authorization: `Bearer ${t}`, apikey: t })
    assertEquals(r.status, 401); zeroCost(r.n)
  }
})

Deno.test('antetul vechi de ocolire, cu orice valoare, fără JWT → 401, zero cost', async () => {
  const valori = ['', 'orice', 'a'.repeat(40), crypto.randomUUID(), 'true']
  for (const v of valori) {
    const r = await ruleaza({ [BYPASS]: v })
    assertEquals(r.status, 401, `valoare de ${v.length} caractere`); zeroCost(r.n)
  }
})

Deno.test('antetul de ocolire + JWT fără drept → 403, zero cost', async () => {
  const r = await ruleaza({ [BYPASS]: 'a'.repeat(40), Authorization: `Bearer ${SANTIER}` })
  assertEquals(r.status, 403); zeroCost(r.n)
})

Deno.test('fără drept → 403 și zero cost: superadmin cu Logistică, manager_santier cu Logistică, admin_logistica fără modul', async () => {
  for (const u of [SUPER, SANTIER, ADMINL_FARA]) {
    const r = await ruleaza({ Authorization: `Bearer ${u}` })
    assertEquals(r.status, 403, u); zeroCost(r.n)
  }
})

Deno.test('poarta stă înaintea cheii Anthropic: fără JWT și fără cheie → 401, nu 500', async () => {
  const r = await ruleaza({}, mediu(), null)
  assertEquals(r.status, 401); zeroCost(r.n)
})

Deno.test('owner, fără mesaje orfane → 200, ajunge la citirea mesajelor', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${OWNER}` }, mediu({ orfane: [] }))
  assertEquals(r.status, 200); assertEquals(r.corp.summary.total, 0)
  assert(r.n.citiri.includes('whatsapp_messages_processed')); assertEquals(r.n.ai, 0)
})

Deno.test('admin_logistica cu modul, un mesaj orfan → 200, poza descărcată, un apel AI', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${ADMINL}` }, mediu({ cuPoza: true }))
  assertEquals(r.status, 200); assertEquals(r.corp.summary.total, 1)
  assertEquals(r.n.storage, 1); assertEquals(r.n.ai, 1)
  assertEquals(r.usage, [{ function_name: 'detect_plate_orphan_msgs', model: 'claude-haiku-5-5',
    tokens_in: 100, tokens_out: 20, cost_usd: 100 * (0.10 / 1e6) + 20 * (0.50 / 1e6), ref_table: 'whatsapp_messages_processed', ref_id: 1 }])
})

Deno.test('owner, cheia Anthropic lipsă → 500 doar DUPĂ poartă', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${OWNER}` }, mediu(), null)
  assertEquals(r.status, 500); assertEquals(r.corp.error, 'ANTHROPIC_API_KEY missing'); zeroCost(r.n)
})

Deno.test('jurnal: HTTP eșuat cu usage se înregistrează; eroarea jurnalului nu schimbă detecția', async () => {
  for (const caz of ['http', 'throw', 'reject', 'result']) {
    const m = mediu({ cuPoza: true }), from0 = m.supa.from
    if (caz !== 'http') m.supa.from = (t: string) => {
      if (t !== 'ai_usage_log') return from0(t)
      return { insert: () => {
        if (caz === 'throw') throw new Error('jurnal indisponibil')
        if (caz === 'reject') return Promise.reject(new Error('jurnal indisponibil'))
        return Promise.resolve({ error: { message: 'jurnal indisponibil' } })
      } }
    }
    const r = await handler(new Request('http://x/', { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` } }),
      () => ({ supa: m.supa, API_KEY: 'k', fetch: () => Promise.resolve(new Response(JSON.stringify({
        usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'text', text: '{"placuta":"PH 21 LBO","confidence":0.99}' }],
      }), { status: caz === 'http' ? 400 : 200 })) }))
    const corp = await r.json()
    assertEquals(r.status, 200)
    if (caz === 'http') {
      assertEquals(corp.results[0].error, 'Anthropic 400')
      assertEquals(m.usage.length, 1)
    } else {
      assertEquals(corp.summary.errors, 0)
      assertEquals(corp.results[0].placuta, 'PH 21 LBO')
    }
  }
})

// JSON-ul valid dintr-un raspuns max_tokens/refuzat nu devine placuta detectata.
for (const caz of [
  { stop_reason: 'max_tokens', text: '{"placuta":"PH 21 LBO","confidence":0.99}', eroare: 'max_tokens' },
  { stop_reason: 'end_turn', text: ' \n ', eroare: 'parse_failed' },
  { stop_reason: 'refusal', text: '{"placuta":"PH 21 LBO","confidence":0.99}', eroare: 'refuz_ai' },
]) {
  Deno.test(`AI ${caz.eroare}: marcheaza FAILED, fara placuta sau alimentare partiala`, async () => {
    const m = mediu({ cuPoza: true })
    const scrieri: { tabel: string; valori: unknown; id: unknown }[] = []
    const from0 = m.supa.from
    m.supa.from = (t: string) => {
      const b = from0(t), update0 = b.update, eq0 = b.eq
      let scriere: typeof scrieri[number] | undefined
      b.update = (valori: unknown) => { scriere = { tabel: t, valori, id: undefined }; scrieri.push(scriere); return update0(valori) }
      b.eq = (c: string, v: unknown) => { if (scriere && c === 'id') scriere.id = v; return eq0(c, v) }
      return b
    }
    const doFetch: typeof fetch = () => {
      m.n.ai++
      return Promise.resolve(new Response(JSON.stringify({ stop_reason: caz.stop_reason,
        content: [{ type: 'text', text: caz.text }], usage: { input_tokens: 100, output_tokens: 20 } }), { status: 200 }))
    }
    const r = await handler(new Request('http://x/', { method: 'POST', headers: { Authorization: `Bearer ${OWNER}` } }),
      () => ({ supa: m.supa, API_KEY: 'k', fetch: doFetch }))
    const corp = await r.json()
    assertEquals(r.status, 200); assertEquals(corp.summary.errors, 1)
    assertEquals(corp.summary.plates_detected, 0); assertEquals(corp.summary.matched, 0)
    assert(corp.results[0].error.includes(caz.eroare)); assertEquals(corp.results[0].placuta, null)
    assertEquals(scrieri, [{ tabel: 'whatsapp_messages_processed', valori: { status: 'no_match', plate_detected: 'FAILED' }, id: 1 }])
    assertEquals(m.n.scrieri, 2); assertEquals(m.n.ai, 1); assertEquals(m.n.storage, 1)
    assertEquals(m.usage.length, 1); assertEquals(m.usage[0].tokens_in, 100)
    assert(!m.n.citiri.includes('logistica_alimentari'))
  })
}
