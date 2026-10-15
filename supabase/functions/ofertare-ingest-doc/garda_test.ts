// deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-net=esm.sh,jsr.io supabase/functions/ofertare-ingest-doc/garda_test.ts
// #553 runda 2 (NO-GO Copilot r1, blocantul 3) — EXACT-ONCE pe EDGE, pe handler-ul real (Deno.serve interceptat, client
// Supabase simulat prin _deps.createClient, Anthropic prin fetch interceptat; pdf-lib real): după `_incearca → continua`,
// fiecare drum (succes, felie + continuare, download eșuat, PDF corupt, Claude HTTP 500, EXCEPȚIE din fetch, EXCEPȚIE din BD,
// update final cu eroare) se termină cu EXACT un `_rezultat` pe tokenul primit. Fără „continua” (in_curs, garda
// indisponibilă, „continua” fără token) sau peste 60 MB în Storage → nicio descărcare, niciun rezultat. Reia → fără
// scurtcircuitul mărime+etag. Nu se deployează (nu e importat de index.ts).
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'
import { REGULA_TABEL, maxOut } from '../_shared/transcriereTabel.ts'

Deno.env.set('SUPABASE_URL', 'https://sb.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-test')
Deno.env.set('ANTHROPIC_API_KEY', 'k-test')
const SECRET = 's'.repeat(40)
Deno.env.set('OFERTARE_INGEST_SECRET', SECRET)

// Anthropic simulat: text cu marcaje, eroare HTTP sau excepție de rețea
// corpuri = cererile trimise (model / thinking / sampling); usage + stop_reason configurabile (Haiku 5.5, 15.10.2026).
// coada = modul pe apel, în ordine (gol → ai.mod): 'max' = text cu stop_reason max_tokens.
type ModAi = 'ok' | 'http500' | 'arunca' | 'refuz' | 'max'
const ai = { mod: 'ok' as ModAi, apeluri: 0, corpuri: [] as any[], usage: { input_tokens: 10, output_tokens: 5 }, coada: [] as ModAi[] }
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('https://api.anthropic.com/')) {
    ai.apeluri++
    ai.corpuri.push(JSON.parse(init.body))
    const mod = ai.coada.shift() ?? ai.mod
    if (mod === 'refuz') return Promise.resolve(new Response(JSON.stringify({ content: [], usage: ai.usage, stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber' } }), { status: 200 }))
    if (mod === 'arunca') return Promise.reject(new TypeError('error sending request: connection reset'))
    if (mod === 'http500') return Promise.resolve(new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 500 }))
    const txt = String(JSON.parse(init.body).messages[0].content[1].text)
    const prima = Number(/prima este pagina (\d+)/.exec(txt)?.[1] ?? 1), nr = Number(/Fragmentul are (\d+)/.exec(txt)?.[1] ?? 1)
    const corp = Array.from({ length: nr }, (_, i) => `⟦PAGINA ${prima + i}⟧\nText pagina ${prima + i}`).join('\n')
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: corp }], usage: ai.usage, stop_reason: mod === 'max' ? 'max_tokens' : 'end_turn' }), { status: 200 }))
  }
  if (u.startsWith('https://sb.test/')) return Promise.reject(new Error('rețea Supabase reală în test: ' + u))
  return fetchReal(input, init)
}) as typeof fetch

let handler: (req: Request) => Promise<Response> = () => { throw new Error('handler necapturat') }
const serveOrig = Object.getOwnPropertyDescriptor(Deno, 'serve')!
Object.defineProperty(Deno, 'serve', { configurable: true, value: (h: any) => { handler = h; return {} } })
const { _deps, costApel } = await import(new URL('./index.ts', import.meta.url).href)
Object.defineProperty(Deno, 'serve', serveOrig)

function pdfMinimal(n: number): Uint8Array {
  const ob: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({ length: n }, (_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let i = 0; i < n; i++) {
    const s = `BT /F1 10 Tf 50 750 Td (Pagina ${i + 1}) Tj ET`
    ob.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`)
    ob.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
  }
  let out = '%PDF-1.4\n'
  const off: number[] = []
  ob.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${ob.length + 1}\n0000000000 65535 f \n${off.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${ob.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return new TextEncoder().encode(out)
}

// elig (loturi 20261024b): răspunsul porții unice — implicit eligibil; 'eroare_rpc' = RPC căzut, 'arunca' = excepție
type Elig = { eligibil: boolean; motiv: string; licitatie_id: number } | 'eroare_rpc' | 'arunca'
type Opt = { elig?: Elig; garda?: 'continua' | 'in_curs' | 'eroare' | 'fara_token'; metaSize?: number; rezultatEsueaza?: boolean; marcajRespins?: boolean; respinge?: boolean; laIncearca?: () => void; aiArunca?: boolean; jurnalEsueaza?: boolean }
function mediu(rand: any, fisier: Uint8Array | null, opt: Opt = {}) {
  const toate: string[] = []
  const tabele: Record<string, any[]> = { ofertare_documente_atribuire: [rand], ofertare_ingest_coada: [{ licitatie_id: rand.licitatie_id, cerut_de: 'u-worker' }], ai_usage_log: [] }
  const g = { incercari: [] as any[], emise: new Set<string>(), rezultate: [] as any[], marcaje: [] as any[], descarcari: 0, scrieriDirecte: [] as any[], meta: 0, elig: [] as any[] }
  const from = (t: string) => {
    tabele[t] ||= []
    const filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    const pot = () => tabele[t].filter(r => filtre.every(f => f(r)))
    const b: any = {
      select: () => b,
      eq: (c: string, v: unknown) => { filtre.push(r => String(r[c]) === String(v)); return b },
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(pot()[0] ?? null), error: null }),
      single: () => Promise.resolve(pot()[0] ? { data: structuredClone(pot()[0]), error: null } : { data: null, error: { message: 'no rows' } }),
      then: (ok: any, ko: any) => new Promise((res, rej) => {
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire') g.scrieriDirecte.push(structuredClone(op.patch))
        if (op.tip === 'ins' && t === 'ai_usage_log' && opt.jurnalEsueaza) return res({ data: null, error: { message: 'permission denied for table ai_usage_log' } })
        if (op.tip === 'ins') { tabele[t].push(structuredClone(op.patch)); return res({ data: null, error: null }) }
        const rows = pot()
        if (op.tip === 'upd') for (const r of rows) Object.assign(r, structuredClone(op.patch))
        res({ data: null, error: null })
      }).then(ok, ko),
    }
    return b
  }
  const rpc = (nume: string, a: any) => {
    if (nume === 'ofertare_doc_are_bucati') return Promise.resolve({ data: false, error: null })
    if (nume === 'fn_ofertare_document_eligibil') {
      g.elig.push(structuredClone(a))
      const e = opt.elig ?? { eligibil: true, motiv: 'fara_loturi', licitatie_id: rand.licitatie_id }
      if (e === 'arunca') return Promise.reject(new Error('rețea'))
      if (e === 'eroare_rpc') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
      return Promise.resolve({ data: e, error: null })
    }
    if (nume === 'ofertare_ingest_garda_incearca') {
      g.incercari.push(structuredClone(a)); opt.laIncearca?.()
      if (opt.garda === 'eroare') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
      if (opt.garda === 'in_curs') return Promise.resolve({ data: { actiune: 'in_curs', motiv: 'altă încercare', pana_la: '2026-09-30T10:10:00Z' }, error: null })
      if (opt.garda === 'fara_token') return Promise.resolve({ data: { actiune: 'continua', descarcari: 1 }, error: null })
      const token = crypto.randomUUID(); g.emise.add(token); toate.push(token)
      return Promise.resolve({ data: { actiune: 'continua', token, descarcari: g.incercari.length, incercari_esuate: 0, ingerat_hash: null }, error: null })
    }
    if (nume === 'ofertare_ingest_garda_rezultat') {
      ;(a.p_rezultat === 'marcaj' ? g.marcaje : g.rezultate).push(structuredClone(a))
      if (opt.rezultatEsueaza && a.p_rezultat !== 'marcaj') return Promise.resolve({ data: null, error: { message: 'rețea' } })
      // serverul (runda 3, J2): token activ ⇒ scrie p_doc atomic; respins ⇒ documentul neatins
      const ok = g.emise.has(a.p_token) && !(a.p_rezultat === 'marcaj' ? opt.marcajRespins : opt.respinge)
      if (ok && a.p_doc) Object.assign(tabele.ofertare_documente_atribuire[0], structuredClone(a.p_doc))
      if (ok && a.p_rezultat !== 'marcaj') g.emise.delete(a.p_token)
      return Promise.resolve({ data: { acceptat: ok, motiv: ok ? undefined : 'token vechi/străin' }, error: null })
    }
    return Promise.resolve({ data: null, error: { message: 'rpc necunoscut ' + nume } })
  }
  const storage = { from: () => ({
    list: (_d: string, o: any) => (g.meta++, Promise.resolve({ data: [{ name: o.search, metadata: { size: opt.metaSize ?? fisier?.length ?? 0, eTag: '"e1"' } }], error: null })),
    download: () => { g.descarcari++; return Promise.resolve(fisier ? { data: new Blob([fisier as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }) },
  }) }
  _deps.createClient = () => ({ from, rpc, storage })
  const exactOnce = () => {
    const pe = new Map<string, number>()
    for (const r of g.rezultate) pe.set(r.p_token, (pe.get(r.p_token) ?? 0) + 1)
    return toate.every(t => pe.get(t) === 1) && [...pe.keys()].every(t => toate.includes(t))
  }
  return { tabele, g, exactOnce, rand: () => tabele.ofertare_documente_atribuire[0] }
}
const doc = (o: any = {}) => ({ id: 55, licitatie_id: 9, fisier_path: '9/atribuire/55.pdf', nume_original: 'Caiet de sarcini.pdf', tip: 'cs_volum',
  status_procesare: 'neprocesat', eroare: null, size_bytes: 2000, pagini_procesate: 0, pagina_offset: 0, pagini_necitite: [], text_extras: null, revizie: null, ...o })
const cere = (body: any = { doc_id: 55, apeluri: 1 }) => handler(new Request('http://x/', { method: 'POST', headers: { 'x-ingest-secret': SECRET, 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const Z = { sanitizeOps: false, sanitizeResources: false }
const rezultate = (m: ReturnType<typeof mediu>) => m.g.rezultate.map(r => r.p_rezultat)

Deno.test({ ...Z, name: 'edge: citire într-o invocare → EXACT un „succes” (sha256 + mărime + etag), documentul procesat', fn: async () => {
  ai.mod = 'ok'
  const pdf = pdfMinimal(2), m = mediu(doc(), pdf)
  const j = await (await cere()).json()
  assertEquals([j.ok, j.status, j.continua], [true, 'procesat', false])
  assert(m.exactOnce()); assertEquals(rezultate(m), ['succes'])
  assertEquals(m.g.rezultate[0].p_size, pdf.length); assertEquals(m.g.rezultate[0].p_etag, '"e1"'); assertMatch(m.g.rezultate[0].p_hash, /^[0-9a-f]{64}$/)
} })

Deno.test({ ...Z, name: 'edge: document pe felii (Sonnet, 2 pagini/felie) → „progres” apoi „succes”, fiecare invocare cu tokenul ei, exact o dată', fn: async () => {
  ai.mod = 'ok'
  const m = mediu(doc({ tip: 'fisa_date' }), pdfMinimal(3))
  const j1 = await (await cere()).json()
  assertEquals([j1.ok, j1.continua, j1.pagini_procesate], [true, true, 2])
  const j2 = await (await cere()).json()
  assertEquals([j2.ok, j2.continua, j2.status], [true, false, 'procesat'])
  assert(m.exactOnce()); assertEquals(rezultate(m), ['progres', 'succes']); assertEquals(m.g.incercari.length, 2)
} })

// ── MODEL (15.10.2026): volumele pe Haiku 5.5, criticele rămân pe Sonnet 5; cerere validă pentru modelele 5.x ──────────
const fara_esantionare = (c: any) => !('temperature' in c) && !('top_p' in c) && !('top_k' in c) && !('output_config' in c)
Deno.test({ ...Z, name: 'model: volum → claude-haiku-5-5, thinking disabled, fără temperature/top_p/top_k; cost Haiku 5.5 în ai_usage_log', fn: async () => {
  ai.mod = 'ok'; ai.corpuri = []
  const m = mediu(doc(), pdfMinimal(2))
  const j = await (await cere()).json()
  assertEquals([j.ok, j.status], [true, 'procesat'])
  assertEquals(ai.corpuri.length, 1)
  const c = ai.corpuri[0]
  assertEquals(c.model, 'claude-haiku-5-5'); assertEquals(c.thinking, { type: 'disabled' }); assert(fara_esantionare(c)); assertEquals(c.max_tokens, 12000)
  const log = m.tabele.ai_usage_log
  assertEquals(log.length, 1); assertEquals(log[0].model, 'claude-haiku-5-5')
  assert(Math.abs(log[0].cost_usd - (10 * 0.10 + 5 * 0.50) / 1e6) < 1e-15, 'cost ' + log[0].cost_usd)
} })

Deno.test({ ...Z, name: 'model: document critic → claude-sonnet-5 (thinking disabled, preț 2/10 ca în _shared/ocrLocal.ts)', fn: async () => {
  ai.mod = 'ok'; ai.corpuri = []
  const m = mediu(doc({ tip: 'fisa_date' }), pdfMinimal(2))
  await (await cere()).json()
  assertEquals(ai.corpuri[0].model, 'claude-sonnet-5'); assertEquals(ai.corpuri[0].thinking, { type: 'disabled' }); assert(fara_esantionare(ai.corpuri[0]))
  assert(Math.abs(m.tabele.ai_usage_log[0].cost_usd - (10 * 2 + 5 * 10) / 1e6) < 1e-15, 'cost ' + m.tabele.ai_usage_log[0].cost_usd)
} })

// ── REGULA DE TABEL + PLAFON (15.10.2026, proba Haiku 4.5 vs 5.5): F3 fără „ | ” pe doc 1294, felii tăiate la 8000 ─────────
const textCerere = (c: any) => c.messages[0].content.find((b: any) => b.type === 'text').text as string
const areRegulaTabel = (t: string) => t.includes(REGULA_TABEL) && t.includes('8 | TSD02B1 | 100 mc | 1,11170') && t.includes('INTERZIS') && !t.includes('celule prin " | "')
Deno.test({ ...Z, name: 'tabel + plafon: Haiku 5.5 → regula TABELE în prompt (text ȘI antet) și max_tokens 12000; Sonnet 5 → aceeași regulă, 8000', fn: async () => {
  ai.mod = 'ok'; ai.corpuri = []
  mediu(doc({ pagini_procesate: 8 }), pdfMinimal(10))   // felie de mijloc → PROMPT_TEXT
  await (await cere()).json()
  assertEquals(ai.corpuri[0].model, 'claude-haiku-5-5'); assertEquals(ai.corpuri[0].max_tokens, 12000)
  assertMatch(textCerere(ai.corpuri[0]), /Fragmentul are 2 pagini; prima este pagina 9/); assert(areRegulaTabel(textCerere(ai.corpuri[0])), 'regula lipsește din PROMPT_TEXT')
  ai.corpuri = []
  mediu(doc(), pdfMinimal(2))   // prima felie → PROMPT_ANTET
  await (await cere()).json()
  assertMatch(textCerere(ai.corpuri[0]), /===TEXT===/); assert(areRegulaTabel(textCerere(ai.corpuri[0])), 'regula lipsește din PROMPT_ANTET')
  ai.corpuri = []
  mediu(doc({ tip: 'fisa_date' }), pdfMinimal(2))
  await (await cere()).json()
  assertEquals(ai.corpuri[0].model, 'claude-sonnet-5'); assertEquals(ai.corpuri[0].max_tokens, 8000); assert(areRegulaTabel(textCerere(ai.corpuri[0])))
} })
Deno.test({ name: 'tabel + plafon: maxOut pe model; ofertare-citire-test folosește ACEEAȘI regulă și același plafon (fără copie locală)', fn: () => {
  assertEquals([maxOut('claude-haiku-5-5'), maxOut('claude-sonnet-5'), maxOut('claude-haiku-4-5-20251001'), maxOut('claude-opus-5')], [12000, 8000, 8000, 8000])
  const src = Deno.readTextFileSync(new URL('../ofertare-citire-test/index.ts', import.meta.url))
  assert(src.includes("import { REGULA_TABEL, maxOut } from '../_shared/transcriereTabel.ts'"))
  assert(src.includes('${REGULA_TABEL}') && src.includes('max_tokens: maxOut(m.id)') && !src.includes('max_tokens: 8000') && !src.includes('celule prin " | "'))
} })

// ── JURNALUL DE COST (Jakarinos r1 pe #724): fiecare răspuns facturat ajunge în ai_usage_log, exact un rând pe invocare ─────
const aproape = (a: number, b: number) => Math.abs(a - b) < 1e-12
const cuUsage = async (usage: { input_tokens: number; output_tokens: number }, fn: () => Promise<void>) => {
  const vechi = ai.usage; ai.usage = usage
  try { await fn() } finally { ai.usage = vechi; ai.coada = []; ai.mod = 'ok' }
}
Deno.test({ ...Z, name: 'cost: două apeluri sub prag (2×60K/1K) → 0,013 USD, nu rata mare pe 120K; un singur rând', fn: () => cuUsage({ input_tokens: 60_000, output_tokens: 1000 }, async () => {
  ai.corpuri = []
  const m = mediu(doc(), pdfMinimal(10))
  const j = await (await cere({ doc_id: 55, apeluri: 2 })).json()
  assertEquals([j.ok, j.status, ai.corpuri.length], [true, 'procesat', 2])
  const log = m.tabele.ai_usage_log
  assertEquals(log.length, 1); assertEquals([log[0].tokens_in, log[0].tokens_out], [120_000, 2000])
  assert(aproape(log[0].cost_usd, 0.013), 'cost ' + log[0].cost_usd)
}) })

Deno.test({ ...Z, name: 'cost: retry după max_tokens (felia înjumătățită) → ambele apeluri facturate, un singur rând', fn: () => cuUsage({ input_tokens: 1000, output_tokens: 12_000 }, async () => {
  ai.corpuri = []; ai.coada = ['max', 'ok']
  const m = mediu(doc(), pdfMinimal(2))
  const j = await (await cere({ doc_id: 55, apeluri: 2 })).json()
  assertEquals(ai.corpuri.length, 2)
  assertMatch(ai.corpuri[1].messages[0].content[1].text, /Fragmentul are 1 pagină; prima este pagina 1/)
  assertEquals([j.ok, j.pagini_procesate, j.continua], [true, 1, true])
  const log = m.tabele.ai_usage_log
  assertEquals(log.length, 1); assertEquals([log[0].tokens_in, log[0].tokens_out], [2000, 24_000])
  assert(aproape(log[0].cost_usd, 2 * (1000 * 0.10 + 12_000 * 0.50) / 1e6), 'cost ' + log[0].cost_usd)
}) })

Deno.test({ ...Z, name: 'cost: succes urmat de eroare (HTTP 500 / excepție) → costul primului apel rămâne în jurnal, un rând, exact un „esec”', fn: async () => {
  for (const al2 of ['http500', 'arunca'] as ModAi[]) await cuUsage({ input_tokens: 60_000, output_tokens: 1000 }, async () => {
    ai.coada = ['ok', al2]
    const m = mediu(doc(), pdfMinimal(10))
    const j = await (await cere({ doc_id: 55, apeluri: 2 })).json()
    assert(j.error, al2); assertEquals(j.jurnal_cost_eroare, undefined, al2)
    assert(m.exactOnce(), al2); assertEquals(rezultate(m), ['esec'], al2)
    const log = m.tabele.ai_usage_log
    assertEquals(log.length, 1, al2); assertEquals([log[0].tokens_in, log[0].tokens_out, log[0].model], [60_000, 1000, 'claude-haiku-5-5'], al2)
    assert(aproape(log[0].cost_usd, 0.0065), al2 + ' cost ' + log[0].cost_usd)
  })
} })

Deno.test({ ...Z, name: 'cost: eroare înainte de orice apel Claude (download) → niciun rând în jurnal', fn: async () => {
  const m = mediu(doc(), null)
  const j = await (await cere()).json()
  assertMatch(j.error, /^download/); assertEquals(m.tabele.ai_usage_log.length, 0)
} })

Deno.test({ ...Z, name: 'cost: insert în ai_usage_log eșuat → raportat în răspuns (jurnal_cost_eroare), citirea nu cade', fn: async () => {
  ai.mod = 'ok'
  const m = mediu(doc(), pdfMinimal(2), { jurnalEsueaza: true })
  const j = await (await cere()).json()
  assertEquals([j.ok, j.status], [true, 'procesat']); assertMatch(j.jurnal_cost_eroare, /^ai_usage_log: permission denied/)
  assert(m.exactOnce()); assertEquals(rezultate(m), ['succes'])
  // și pe drumul de eroare
  ai.coada = ['ok', 'http500']
  try {
    const m2 = mediu(doc(), pdfMinimal(10), { jurnalEsueaza: true })
    const j2 = await (await cere({ doc_id: 55, apeluri: 2 })).json()
    assertMatch(j2.error, /^Claude paginile 9-10/); assertMatch(j2.jurnal_cost_eroare, /^ai_usage_log: permission denied/)
    assert(m2.exactOnce()); assertEquals(rezultate(m2), ['esec'])
  } finally { ai.coada = [] }
} })

Deno.test({ ...Z, name: 'refuz urmat de continuare cu offset (bucata p49+) → paginile refuzate necitite cu numerotarea originală, restul citite', fn: () => cuUsage({ input_tokens: 10, output_tokens: 5 }, async () => {
  ai.coada = ['refuz', 'ok']
  const m = mediu(doc({ pagina_offset: 48 }), pdfMinimal(10))
  const j = await (await cere({ doc_id: 55, apeluri: 2 })).json()
  assertEquals([j.ok, j.status, j.continua], [true, 'partial', false])
  assertEquals(j.pagini_necitite, [49, 50, 51, 52, 53, 54, 55, 56])
  const t = String(m.rand().text_extras)
  assertMatch(t, /⟦PAGINA 49⟧\n\[PAGINA 49: NECITITĂ — modelul a refuzat transcrierea \(cyber\)\]/)
  assertMatch(t, /⟦PAGINA 57⟧\nText pagina 57/); assertMatch(t, /⟦PAGINA 58⟧\nText pagina 58/)
  assertEquals(m.tabele.ai_usage_log.length, 1); assertEquals(m.tabele.ai_usage_log[0].tokens_in, 20)   // refuzul e facturat
  assert(m.exactOnce())
}) })

Deno.test({ ...Z, name: 'cost: Haiku 5.5 peste 100K tokeni de intrare pe apel → rata 0,50 / 2,50; pragul e pe apel, nu pe sumă', fn: async () => {
  const H = { id: 'claude-haiku-5-5', in: 0.10 / 1e6, out: 0.50 / 1e6, felie: 8, prag: 100_000, peste: { in: 0.50 / 1e6, out: 2.50 / 1e6 } }
  assert(Math.abs(costApel(H, 100_000, 1000) - (100_000 * 0.10 + 1000 * 0.50) / 1e6) < 1e-12)   // exact pe prag = rata mică
  assert(Math.abs(costApel(H, 100_001, 1000) - (100_001 * 0.50 + 1000 * 2.50) / 1e6) < 1e-12)
  // pe handler: un apel de 150K tokeni intră la rata mare
  ai.mod = 'ok'; ai.usage = { input_tokens: 150_000, output_tokens: 2000 }
  try {
    const m = mediu(doc(), pdfMinimal(2))
    await (await cere()).json()
    assert(Math.abs(m.tabele.ai_usage_log[0].cost_usd - (150_000 * 0.50 + 2000 * 2.50) / 1e6) < 1e-12, 'cost ' + m.tabele.ai_usage_log[0].cost_usd)
  } finally { ai.usage = { input_tokens: 10, output_tokens: 5 } }
} })

Deno.test({ ...Z, name: 'refuz: stop_reason refusal → paginile feliei NECITITE (status partial), nu „procesat” cu text gol', fn: async () => {
  ai.mod = 'refuz'
  try {
    const m = mediu(doc(), pdfMinimal(2))
    const j = await (await cere()).json()
    assertEquals(j.ok, true); assertEquals(m.rand().status_procesare, 'partial')
    assertEquals([...(m.rand().pagini_necitite ?? [])].sort(), [1, 2])
    assert(m.exactOnce())
  } finally { ai.mod = 'ok' }
} })

Deno.test({ ...Z, name: 'edge: download eșuat / PDF corupt / Claude HTTP 500 / update final cu eroare → EXACT un „esec” fiecare', fn: async () => {
  const cazuri: Array<[string, () => ReturnType<typeof mediu>, RegExp]> = [
    ['download', () => mediu(doc(), null), /^download: Object not found/],
    ['pdf corupt', () => mediu(doc(), new TextEncoder().encode('nu e PDF')), /^PDF corupt/],
    ['claude 500', () => { ai.mod = 'http500'; return mediu(doc(), pdfMinimal(2)) }, /^Claude paginile 1-2: overloaded/],
  ]
  for (const [nume, fa, re] of cazuri) {
    const m = fa()
    const j = await (await cere()).json()
    assertMatch(j.error, re, nume)
    assert(m.exactOnce(), nume); assertEquals(rezultate(m), ['esec'], nume); assertMatch(m.g.rezultate[0].p_eroare, re, nume)
    assertEquals(m.rand().status_procesare, 'eroare', nume)
  }
  ai.mod = 'ok'
} })

Deno.test({ ...Z, name: 'edge: EXCEPȚIE aruncată (fetch către Claude / update BD) după „continua” → EXACT un „esec”, documentul „eroare”', fn: async () => {
  ai.mod = 'arunca'
  const m1 = mediu(doc(), pdfMinimal(2))
  const j1 = await (await cere()).json()
  assertMatch(j1.error, /^Eroare neasteptata: error sending request/)
  assert(m1.exactOnce()); assertEquals(rezultate(m1), ['esec']); assertMatch(m1.g.rezultate[0].p_eroare, /Eroare neasteptata/)
  ai.mod = 'ok'
  assertEquals(m1.g.scrieriDirecte.length, 0)   // 'eroare' scris de server, sub token
} })

Deno.test({ ...Z, name: 'edge: fără „continua” (in_curs / garda indisponibilă / fără token) → fără descărcare, fără rezultat, documentul neatins', fn: async () => {
  for (const mod of ['in_curs', 'eroare', 'fara_token'] as const) {
    const m = mediu(doc(), pdfMinimal(2), { garda: mod })
    const j = await (await cere()).json()
    assertEquals(j.ok, false); assert(j.garda, mod)
    assertEquals(m.g.descarcari, 0, mod); assertEquals(m.g.rezultate.length, 0, mod); assertEquals(m.rand().status_procesare, 'neprocesat', mod)
  }
} })

Deno.test({ ...Z, name: 'edge: peste 60 MB după mărimea din Storage (size_bytes mic în BD) → „ignorat”, fără gardă și fără descărcare', fn: async () => {
  const m = mediu(doc({ size_bytes: 1000 }), pdfMinimal(2), { metaSize: 61 * 1024 * 1024 })
  const j = await (await cere()).json()
  assertEquals([j.ok, j.skip], [true, 'prea mare'])
  assertEquals(m.g.incercari.length, 0); assertEquals(m.g.descarcari, 0)
  assertEquals(m.rand().status_procesare, 'ignorat'); assertMatch(m.rand().eroare, /^prea mare pentru citirea automată \(61 MB > 60 MB, mărimea din Storage\)/)
} })

Deno.test({ ...Z, name: 'edge: reia (partial → de la zero) → garda fără mărime+etag (nu „deja_ingerat”); altfel le primește', fn: async () => {
  ai.mod = 'ok'
  const m = mediu(doc({ status_procesare: 'partial' }), pdfMinimal(2))
  await (await cere({ doc_id: 55, apeluri: 1, reia: true })).json()
  assertEquals([m.g.incercari[0].p_size, m.g.incercari[0].p_etag], [null, null])
  const m2 = mediu(doc(), pdfMinimal(2))
  await (await cere()).json()
  assertEquals(m2.g.incercari[0].p_etag, '"e1"')
  assert(m.exactOnce() && m2.exactOnce())
} })

Deno.test({ ...Z, name: 'edge: RPC-ul _rezultat pică → răspunsul rămâne cel al drumului, o singură trimitere', fn: async () => {
  ai.mod = 'ok'
  const m = mediu(doc(), pdfMinimal(2), { rezultatEsueaza: true })
  const j = await (await cere()).json()
  // runda 3: documentul îl scrie RPC-ul care a picat ⇒ nu pretindem „procesat”
  assertEquals([j.ok, j.garda], [false, 'rezultat_respins']); assertEquals(rezultate(m), ['succes'])
} })

Deno.test({ ...Z, name: 'J1 (Jakarinos): progresul avansat de alții ÎNTRE citirea inițială și token → recitit sub lease, fără regres (4 → 6, nu 2)', fn: async () => {
  ai.mod = 'ok'
  // A citește documentul cu 0 pagini; până obține tokenul, alte încercări au ajuns la 4 pagini (text inclus)
  const m = mediu(doc({ tip: 'fisa_date' }), pdfMinimal(6), { laIncearca: () => Object.assign(m.rand(), { pagini_procesate: 4, status_procesare: 'in_lucru', text_extras: '⟦PAGINA 1⟧ A\n⟦PAGINA 4⟧ D', pagini_felie: 2 }) })
  const j = await (await cere()).json()
  assertEquals([j.ok, j.pagini_procesate], [true, 6])
  assertMatch(m.rand().text_extras, /⟦PAGINA 4⟧ D[\s\S]*⟦PAGINA 5⟧/)   // textul lui 1–4 păstrat, continuat de la 5
  assertEquals(m.g.scrieriDirecte.length, 0)
} })

Deno.test({ ...Z, name: 'J1: documentul încheiat de altă încercare înainte de token → „predat”, fără descărcare', fn: async () => {
  const m = mediu(doc(), pdfMinimal(2), { laIncearca: () => Object.assign(m.rand(), { status_procesare: 'procesat' }) })
  const j = await (await cere()).json()
  assertMatch(j.skip, /deja procesat \(recitit sub lease\)/); assertEquals(m.g.descarcari, 0); assertEquals(rezultate(m), ['predat'])
} })

Deno.test({ ...Z, name: 'J2 (Jakarinos): încercarea veche (token preluat) termină felia → serverul respinge, progresul nou NU e suprascris', fn: async () => {
  ai.mod = 'ok'
  const m = mediu(doc(), pdfMinimal(2), { respinge: true })
  const inainte = structuredClone(m.rand())
  const j = await (await cere()).json()
  assertEquals([j.ok, j.garda], [false, 'rezultat_respins'])
  assertEquals(m.rand().text_extras, inainte.text_extras); assertEquals(m.rand().pagini_procesate, inainte.pagini_procesate)
  assertEquals(m.g.scrieriDirecte.length, 0)
} })

Deno.test({ ...Z, name: 'J2: marcajul in_lucru respins (lease pierdut) → nu citește, documentul neatins', fn: async () => {
  const m = mediu(doc(), pdfMinimal(2), { marcajRespins: true })
  const j = await (await cere()).json()
  const ai0 = ai.apeluri
  assertEquals([j.ok, j.garda], [false, 'token_pierdut'])
  assertEquals(m.rand().status_procesare, 'neprocesat'); assertEquals(m.g.scrieriDirecte.length, 0)
} })

// ── LOTURI (20261024b): poarta unică înaintea oricărui cost ──────────────────────────────────────────────────────────
const zeroCost = (m: ReturnType<typeof mediu>, ai0: number, et: string) => {
  assertEquals(ai.apeluri, ai0, et + ': apeluri AI'); assertEquals(m.g.descarcari, 0, et + ': descărcări'); assertEquals(m.g.meta, 0, et + ': Storage')
  assertEquals(m.g.incercari.length, 0, et + ': gardă'); assertEquals(m.g.rezultate.length, 0, et + ': rezultate'); assertEquals(m.tabele.ai_usage_log.length, 0, et + ': cost')
}

Deno.test({ ...Z, name: 'loturi: neeligibil → blocat_lot (HTTP 200, fără throw), zero AI / Storage / gardă / cost; motivul în eroare, statusul neatins', fn: async () => {
  ai.mod = 'ok'
  for (const motiv of ['loturi_neinitializate', 'nicio_participare', 'de_triat', 'in_afara_loturilor', 'stare_invalida']) {
    const m = mediu(doc(), pdfMinimal(2), { elig: { eligibil: false, motiv, licitatie_id: 9 } })
    const ai0 = ai.apeluri
    const r = await cere()
    assertEquals(r.status, 200)
    const j = await r.json()
    assertEquals([j.ok, j.blocat_lot, j.motiv, j.continua], [false, true, motiv, false], motiv)
    assertMatch(j.error, /^Blocat pe loturi: /)
    zeroCost(m, ai0, motiv)
    assertEquals(m.g.elig, [{ p_document_id: 55 }])
    assertEquals(m.rand().status_procesare, 'neprocesat', motiv); assertMatch(m.rand().eroare, /^Blocat pe loturi: /)
  }
} })

Deno.test({ ...Z, name: 'loturi: fișa de date pe licitație neinițializată → blocată ca orice document (fără excepție în cod)', fn: async () => {
  const m = mediu(doc({ tip: 'fisa_date' }), pdfMinimal(2), { elig: { eligibil: false, motiv: 'loturi_neinitializate', licitatie_id: 9 } })
  const ai0 = ai.apeluri
  const j = await (await cere()).json()
  assertEquals([j.ok, j.blocat_lot, j.motiv], [false, true, 'loturi_neinitializate']); zeroCost(m, ai0, 'fisa_date')
} })

Deno.test({ ...Z, name: 'loturi: eroare RPC / excepție / răspuns fără formă → blocat (fail-closed, eroare_poarta), zero cost', fn: async () => {
  for (const e of ['eroare_rpc', 'arunca', { eligibil: 'da', motiv: 1 } as any] as Elig[]) {
    const m = mediu(doc(), pdfMinimal(2), { elig: e })
    const ai0 = ai.apeluri
    const j = await (await cere()).json()
    assertEquals([j.ok, j.blocat_lot, j.motiv], [false, true, 'eroare_poarta'], String(e)); zeroCost(m, ai0, String(e))
    assertEquals(m.rand().eroare, 'Blocat pe loturi: verificarea pe loturi nu a răspuns')
  }
} })

Deno.test({ ...Z, name: 'loturi: document rămas in_lucru (felii anterioare) devenit neeligibil → neprocesat, pagini_procesate păstrate', fn: async () => {
  const m = mediu(doc({ status_procesare: 'in_lucru', pagini_procesate: 4, text_extras: '⟦PAGINA 1⟧ A' }), pdfMinimal(6), { elig: { eligibil: false, motiv: 'in_afara_loturilor', licitatie_id: 9 } })
  const ai0 = ai.apeluri
  const j = await (await cere()).json()
  assertEquals(j.blocat_lot, true); zeroCost(m, ai0, 'in_lucru')
  assertEquals([m.rand().status_procesare, m.rand().pagini_procesate, m.rand().text_extras], ['neprocesat', 4, '⟦PAGINA 1⟧ A'])
} })

Deno.test({ ...Z, name: 'loturi: neautorizat → 401/403 ÎNAINTE de poartă (nicio scriere pe document), procesat → skip fără poartă', fn: async () => {
  const m = mediu(doc(), pdfMinimal(2), { elig: { eligibil: false, motiv: 'de_triat', licitatie_id: 9 } })
  const r = await handler(new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc_id: 55 }) }))
  assert(r.status === 401 || r.status === 403, String(r.status)); await r.body?.cancel()
  assertEquals(m.g.elig.length, 0); assertEquals(m.g.scrieriDirecte.length, 0)
  const m2 = mediu(doc({ status_procesare: 'procesat' }), pdfMinimal(2), { elig: { eligibil: false, motiv: 'de_triat', licitatie_id: 9 } })
  const j = await (await cere()).json()
  assertEquals(j.skip, 'deja procesat'); assertEquals(m2.g.scrieriDirecte.length, 0)
} })

Deno.test({ ...Z, name: 'loturi: eligibil (comun / lot_participam / fara_loturi) → citirea merge ca înainte', fn: async () => {
  ai.mod = 'ok'
  for (const motiv of ['comun', 'lot_participam', 'fara_loturi']) {
    const m = mediu(doc(), pdfMinimal(2), { elig: { eligibil: true, motiv, licitatie_id: 9 } })
    const j = await (await cere()).json()
    assertEquals([j.ok, j.status], [true, 'procesat'], motiv); assert(m.exactOnce())
  }
} })
