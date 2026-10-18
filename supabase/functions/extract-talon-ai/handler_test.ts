// deno test supabase/functions/extract-talon-ai/handler_test.ts
// Testul de handler (securitate etapa 2 grup B): verifică la nivelul funcției întregi, nu doar al acces.ts, că nicio cerere
// fără drept — inclusiv cu vechiul antet intern x-internal-secret, cu orice valoare — nu citește documente, nu descarcă
// scanuri, nu cheamă AI, nu scrie în talon_extract_staging și nici măcar nu citește corpul cererii.
// Dacă cineva reintroduce o cale care sare peste poartaTalon, testele „zero cost” pică.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { fakeFetch, fakeSupa } from '../_test/fake_supa.ts'
import { handler } from './handler.ts'

const OWNER = 'u-owner', ADMINL = 'u-adminl', ADMINL_FARA = 'u-adminl-fara-modul', SUPER = 'u-super', SANTIER = 'u-santier', CONTAB = 'u-contab'
const PROFILES = [
  { id: OWNER, is_owner: true, role: 'superadmin' },
  { id: ADMINL, is_owner: false, role: 'admin_logistica' },
  { id: ADMINL_FARA, is_owner: false, role: 'admin_logistica' },
  { id: SUPER, is_owner: false, role: 'superadmin' },
  { id: SANTIER, is_owner: false, role: 'manager_santier' },
  { id: CONTAB, is_owner: false, role: 'contabilitate' },
]
const UMA = [
  { profile_id: ADMINL, module: 'logistica' }, { profile_id: SUPER, module: 'logistica' },
  { profile_id: SANTIER, module: 'logistica' }, { profile_id: CONTAB, module: 'logistica' },
  { profile_id: ADMINL_FARA, module: 'magazie' },
]
const DOCS = [{ id: 501, active_id: 7, tip_id: 10, pdf_url: 'flota/7/talon.pdf', observatii: 'talon (NAS)' }]
const ACTIVE = [{ id: 7, nr_inmatriculare: 'PH 21 LBO', serie_sasiu: null, serie_motor: null, an_fabricatie: null, capacitate_motor: null, putere_kw: null, tip_carburant: null, greutate_kg: null }]
const ANTET_VECHI = 'x-internal-secret'

// auth simulat: token „u-…” = utilizator real; orice altceva (cheia anon, JWT fals) = respins de Auth
const getUser = (jwt: string) => Promise.resolve(jwt.startsWith('u-')
  ? { data: { user: { id: jwt } }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } })

// fake_supa comun + ce îi lipsește pentru funcția asta: auth.getUser, descărcare de scan reușită (opțional)
function mediu(o: { procesate?: number[]; cuScan?: boolean } = {}) {
  const { supa, n } = fakeSupa({
    profiles: PROFILES, user_module_access: UMA, logistica_documente: DOCS, logistica_active: ACTIVE,
    talon_extract_staging: (o.procesate ?? []).map((active_id) => ({ active_id })),
  })
  const s = supa as any
  s.auth = { getUser }
  if (o.cuScan) s.storage = { from: () => ({ download: () => { n.storage++; return Promise.resolve({ data: new Blob([new Uint8Array([37, 80, 68, 70])]), error: null }) } }) }
  return { supa: s, n }
}
const cerereCu = (headers: Record<string, string>, body?: unknown) =>
  new Request('http://x/', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })
// cheie: null = ANTHROPIC_API_KEY lipsă (un `undefined` explicit ar lua valoarea implicită 'k')
async function ruleaza(headers: Record<string, string>, m = mediu(), cheie: string | null = 'k', body?: unknown) {
  const req = cerereCu(headers, body)
  const r = await handler(req, () => ({ supa: m.supa, API_KEY: cheie ?? undefined, fetch: fakeFetch(m.n) }))
  return { status: r.status, corp: await r.json(), n: m.n, corpCitit: req.bodyUsed }
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

Deno.test('OPTIONS: 200, fără antetul intern în CORS, zero citiri', async () => {
  const m = mediu()
  const r = await handler(new Request('http://x/', { method: 'OPTIONS' }), () => ({ supa: m.supa, API_KEY: 'k', fetch: fakeFetch(m.n) }))
  assertEquals(r.status, 200)
  const permise = (r.headers.get('Access-Control-Allow-Headers') || '').toLowerCase()
  assert(!permise.includes('internal') && !permise.includes('secret'), permise)
  assertEquals(m.n.citiri, [])
})

Deno.test('fabrica de dependențe aruncă: OPTIONS tot 200 cu CORS (fabrica nechemată), POST → 500 JSON cu CORS', async () => {
  const f1 = fabricaCareArunca()
  const o = await handler(new Request('http://x/', { method: 'OPTIONS' }), f1)
  assertEquals(o.status, 200); assertEquals(o.headers.get('Access-Control-Allow-Origin'), '*'); assertEquals(f1.chemari, 0)
  const f2 = fabricaCareArunca()
  const p = await handler(cerereCu({ Authorization: `Bearer ${OWNER}` }), f2)
  assertEquals(p.status, 500); assertEquals(f2.chemari, 1)
  assertEquals(p.headers.get('Access-Control-Allow-Origin'), '*')
  assert((p.headers.get('Content-Type') || '').includes('application/json'))
  assertEquals((await p.json()).error, 'SUPABASE_URL lipsă')
})

Deno.test('fără Authorization → 401 „Neautorizat”, zero cost, corpul necitit', async () => {
  const r = await ruleaza({}, mediu(), 'k', { active_id: 7 })
  assertEquals(r.status, 401); assertEquals(r.corp.error, 'Neautorizat'); zeroCost(r.n); assertEquals(r.n.citiri, [])
  assertEquals(r.corpCitit, false)
})

Deno.test('cheia anon / JWT fals → 401 „Neautorizat”, zero cost', async () => {
  for (const t of ['eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.semnatura', 'invalid']) {
    const r = await ruleaza({ Authorization: `Bearer ${t}`, apikey: t })
    assertEquals(r.status, 401); assertEquals(r.corp.error, 'Neautorizat'); zeroCost(r.n)
  }
})

Deno.test('antetul intern vechi, cu orice valoare, fără JWT → 401, zero cost', async () => {
  const valori = ['', 'orice', 'a'.repeat(24), 'b'.repeat(24), crypto.randomUUID(), 'true']
  for (const v of valori) {
    const r = await ruleaza({ [ANTET_VECHI]: v }, mediu(), 'k', { active_id: 7 })
    assertEquals(r.status, 401, `valoare de ${v.length} caractere`); assertEquals(r.corp.error, 'Neautorizat'); zeroCost(r.n)
    assertEquals(r.corpCitit, false)
  }
})

Deno.test('antetul intern vechi + JWT fără drept → 403, zero cost', async () => {
  const r = await ruleaza({ [ANTET_VECHI]: 'a'.repeat(24), Authorization: `Bearer ${SANTIER}` })
  assertEquals(r.status, 403); zeroCost(r.n)
})

Deno.test('fără drept → 403, zero cost, corpul necitit: superadmin / manager_santier / contabilitate cu Logistică, admin_logistica fără modul', async () => {
  for (const u of [SUPER, SANTIER, CONTAB, ADMINL_FARA]) {
    const r = await ruleaza({ Authorization: `Bearer ${u}` }, mediu(), 'k', { active_id: 7 })
    assertEquals(r.status, 403, u); assertEquals(r.corp.error, 'forbidden'); zeroCost(r.n)
    assertEquals(r.corpCitit, false, u)
  }
})

Deno.test('poarta stă înaintea cheii Anthropic: fără JWT și fără cheie → 401, nu 500', async () => {
  const r = await ruleaza({}, mediu(), null)
  assertEquals(r.status, 401); zeroCost(r.n)
})

Deno.test('owner, cheia Anthropic lipsă → 500 doar DUPĂ poartă, zero cost', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${OWNER}` }, mediu(), null)
  assertEquals(r.status, 500); assertEquals(r.corp.error, 'ANTHROPIC_API_KEY missing'); zeroCost(r.n)
})

Deno.test('owner, toate vehiculele procesate → 200 idle, fără AI și fără scrieri', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${OWNER}` }, mediu({ procesate: [7] }))
  assertEquals(r.status, 200); assertEquals(r.corp.idle, true)
  assert(r.n.citiri.includes('logistica_documente')); assertEquals(r.n.ai, 0); assertEquals(r.n.scrieri, 0)
})

Deno.test('admin_logistica cu modul, active_id dat → 200, un scan descărcat, un apel AI, un rând în talon_extract_staging', async () => {
  const r = await ruleaza({ Authorization: `Bearer ${ADMINL}` }, mediu({ cuScan: true }), 'k', { active_id: 7 })
  assertEquals(r.status, 200); assertEquals(r.corp.success, true); assertEquals(r.corp.active_id, 7)
  assertEquals(r.n.storage, 1); assertEquals(r.n.ai, 1); assertEquals(r.n.scrieri, 1)
  assert(r.n.citiri.includes('talon_extract_staging'))
})

// Chiar si un JSON valid trebuie respins daca raspunsul e taiat sau refuzat.
for (const caz of [
  { stop_reason: 'max_tokens', text: '{"nr_inmatriculare":"PH 21 LBO"}', eroare: 'max_tokens' },
  { stop_reason: 'end_turn', text: ' \n ', eroare: 'fara text' },
  { stop_reason: 'refusal', text: '{"nr_inmatriculare":"PH 21 LBO"}', eroare: 'refuzat' },
]) {
  Deno.test(`AI ${caz.eroare}: eroare de business, zero scrieri in staging`, async () => {
    const m = mediu({ cuScan: true })
    const doFetch: typeof fetch = () => {
      m.n.ai++
      return Promise.resolve(new Response(JSON.stringify({ stop_reason: caz.stop_reason,
        content: [{ type: 'text', text: caz.text }] }), { status: 200 }))
    }
    const r = await handler(cerereCu({ Authorization: `Bearer ${OWNER}` }, { active_id: 7 }),
      () => ({ supa: m.supa, API_KEY: 'k', fetch: doFetch }))
    const corp = await r.json()
    assertEquals(r.status, 200); assertEquals(corp.success, false); assertEquals(corp.active_id, 7)
    assert(corp.error.includes(caz.eroare))
    assertEquals(m.n.ai, 1); assertEquals(m.n.storage, 1); assertEquals(m.n.scrieri, 0)
    assert(!m.n.citiri.includes('logistica_active'))
  })
}
