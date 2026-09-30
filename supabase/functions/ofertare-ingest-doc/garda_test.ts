// deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-net=esm.sh,jsr.io supabase/functions/ofertare-ingest-doc/garda_test.ts
// #553 runda 2 (NO-GO Copilot r1, blocantul 3) — EXACT-ONCE pe EDGE, pe handler-ul real (Deno.serve interceptat, client
// Supabase simulat prin _deps.createClient, Anthropic prin fetch interceptat; pdf-lib real): după `_incearca → continua`,
// fiecare drum (succes, felie + continuare, download eșuat, PDF corupt, Claude HTTP 500, EXCEPȚIE din fetch, EXCEPȚIE din BD,
// update final cu eroare) se termină cu EXACT un `_rezultat` pe tokenul primit. Fără „continua” (in_curs, garda
// indisponibilă, „continua” fără token) sau peste 60 MB în Storage → nicio descărcare, niciun rezultat. Reia → fără
// scurtcircuitul mărime+etag. Nu se deployează (nu e importat de index.ts).
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'

Deno.env.set('SUPABASE_URL', 'https://sb.test')
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test')
Deno.env.set('SUPABASE_ANON_KEY', 'anon-test')
Deno.env.set('ANTHROPIC_API_KEY', 'k-test')
const SECRET = 's'.repeat(40)
Deno.env.set('OFERTARE_INGEST_SECRET', SECRET)

// Anthropic simulat: text cu marcaje, eroare HTTP sau excepție de rețea
const ai = { mod: 'ok' as 'ok' | 'http500' | 'arunca', apeluri: 0 }
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('https://api.anthropic.com/')) {
    ai.apeluri++
    if (ai.mod === 'arunca') return Promise.reject(new TypeError('error sending request: connection reset'))
    if (ai.mod === 'http500') return Promise.resolve(new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 500 }))
    const txt = String(JSON.parse(init.body).messages[0].content[1].text)
    const prima = Number(/prima este pagina (\d+)/.exec(txt)?.[1] ?? 1), nr = Number(/Fragmentul are (\d+)/.exec(txt)?.[1] ?? 1)
    const corp = Array.from({ length: nr }, (_, i) => `⟦PAGINA ${prima + i}⟧\nText pagina ${prima + i}`).join('\n')
    return Promise.resolve(new Response(JSON.stringify({ content: [{ type: 'text', text: corp }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' }), { status: 200 }))
  }
  if (u.startsWith('https://sb.test/')) return Promise.reject(new Error('rețea Supabase reală în test: ' + u))
  return fetchReal(input, init)
}) as typeof fetch

let handler: (req: Request) => Promise<Response> = () => { throw new Error('handler necapturat') }
const serveOrig = Object.getOwnPropertyDescriptor(Deno, 'serve')!
Object.defineProperty(Deno, 'serve', { configurable: true, value: (h: any) => { handler = h; return {} } })
const { _deps } = await import(new URL('./index.ts', import.meta.url).href)
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

type Opt = { garda?: 'continua' | 'in_curs' | 'eroare' | 'fara_token'; metaSize?: number; rezultatEsueaza?: boolean; updateInLucruArunca?: boolean; updateFinalEroare?: boolean }
function mediu(rand: any, fisier: Uint8Array | null, opt: Opt = {}) {
  const tabele: Record<string, any[]> = { ofertare_documente_atribuire: [rand], ofertare_ingest_coada: [{ licitatie_id: rand.licitatie_id, cerut_de: 'u-worker' }], ai_usage_log: [] }
  const g = { incercari: [] as any[], emise: new Set<string>(), rezultate: [] as any[], descarcari: 0 }
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
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire') {
          if (opt.updateInLucruArunca && op.patch.status_procesare === 'in_lucru' && 'procesat_de' in op.patch) return rej(new Error('BD: conexiune pierdută'))
          if (opt.updateFinalEroare && 'text_extras' in op.patch) return res({ data: null, error: { message: 'constrângere încălcată' } })
        }
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
    if (nume === 'ofertare_ingest_garda_incearca') {
      g.incercari.push(structuredClone(a))
      if (opt.garda === 'eroare') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
      if (opt.garda === 'in_curs') return Promise.resolve({ data: { actiune: 'in_curs', motiv: 'altă încercare', pana_la: '2026-09-30T10:10:00Z' }, error: null })
      if (opt.garda === 'fara_token') return Promise.resolve({ data: { actiune: 'continua', descarcari: 1 }, error: null })
      const token = crypto.randomUUID(); g.emise.add(token)
      return Promise.resolve({ data: { actiune: 'continua', token, descarcari: g.incercari.length, incercari_esuate: 0, ingerat_hash: null }, error: null })
    }
    if (nume === 'ofertare_ingest_garda_rezultat') {
      g.rezultate.push(structuredClone(a))
      if (opt.rezultatEsueaza) return Promise.resolve({ data: null, error: { message: 'rețea' } })
      return Promise.resolve({ data: { acceptat: g.emise.has(a.p_token) }, error: null })
    }
    return Promise.resolve({ data: null, error: { message: 'rpc necunoscut ' + nume } })
  }
  const storage = { from: () => ({
    list: (_d: string, o: any) => Promise.resolve({ data: [{ name: o.search, metadata: { size: opt.metaSize ?? fisier?.length ?? 0, eTag: '"e1"' } }], error: null }),
    download: () => { g.descarcari++; return Promise.resolve(fisier ? { data: new Blob([fisier as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }) },
  }) }
  _deps.createClient = () => ({ from, rpc, storage })
  const exactOnce = () => {
    const pe = new Map<string, number>()
    for (const r of g.rezultate) pe.set(r.p_token, (pe.get(r.p_token) ?? 0) + 1)
    return [...g.emise].every(t => pe.get(t) === 1) && [...pe.keys()].every(t => g.emise.has(t))
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
  assert(m.exactOnce()); assertEquals(rezultate(m), ['progres', 'succes']); assertEquals(m.g.emise.size, 2)
} })

Deno.test({ ...Z, name: 'edge: download eșuat / PDF corupt / Claude HTTP 500 / update final cu eroare → EXACT un „esec” fiecare', fn: async () => {
  const cazuri: Array<[string, () => ReturnType<typeof mediu>, RegExp]> = [
    ['download', () => mediu(doc(), null), /^download: Object not found/],
    ['pdf corupt', () => mediu(doc(), new TextEncoder().encode('nu e PDF')), /^PDF corupt/],
    ['claude 500', () => { ai.mod = 'http500'; return mediu(doc(), pdfMinimal(2)) }, /^Claude paginile 1-2: overloaded/],
    ['update final', () => { ai.mod = 'ok'; return mediu(doc(), pdfMinimal(2), { updateFinalEroare: true }) }, /^update: constrângere/],
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
  const m2 = mediu(doc(), pdfMinimal(2), { updateInLucruArunca: true })
  const j2 = await (await cere()).json()
  assertMatch(j2.error, /^Eroare neasteptata: BD: conexiune pierdută/)
  assert(m2.exactOnce()); assertEquals(rezultate(m2), ['esec'])
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
  assertEquals([j.ok, j.status], [true, 'procesat']); assertEquals(rezultate(m), ['succes'])
} })
