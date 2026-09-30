// deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-write=/tmp --allow-run=pdftotext,pdfinfo worker/ofertare/ingest_garda_test.ts
// #553 runda 2 (NO-GO Copilot r1, blocantul 3) — EXACT-ONCE pe worker: după `_incearca → continua`, FIECARE drum din
// citesteDocument se termină cu EXACT un `_rezultat` pe tokenul primit: succes (text local), esec (download, update, excepție
// din blob / pdfinfo / pdftotext / BD), predat (scan → edge, > 60 MB → citire_mare). Fără „continua” (in_curs, garda
// indisponibilă, „continua” fără token) → nicio descărcare și niciun rezultat. Plus filtrul de candidați (lease activ).
// BD simulată, fără rețea (fetch interceptat: edge și Anthropic); importă ingest.ts (esm.sh la prima rulare).
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'

const URL_SB = 'https://sb.test'
Deno.env.set('SUPABASE_URL', URL_SB)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test')
Deno.env.set('ANTHROPIC_API_KEY', 'k-test')
Deno.env.set('OFERTARE_INGEST_SECRET', 's'.repeat(40))

const retea = { edge: 0, anthropic: 0 }
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('data:')) return fetchReal(input, init)
  if (u === `${URL_SB}/functions/v1/ofertare-ingest-doc`) {
    retea.edge++
    return Promise.resolve(new Response(JSON.stringify({ ok: true, doc_id: JSON.parse(init.body).doc_id, pagini: 2, pagini_procesate: 2, status: 'procesat', continua: false }), { status: 200 }))
  }
  if (u.startsWith('https://api.anthropic.com/')) { retea.anthropic++; return Promise.resolve(new Response(JSON.stringify({ error: { message: 'fără AI în test' } }), { status: 500 })) }
  return Promise.reject(new Error(`rețea interzisă în test: ${u}`))
}) as typeof fetch

const { citesteDocument, proceseazaIngest, PAUZE, ceas } = await import(new URL('./ingest.ts', import.meta.url).href)
PAUZE.edgeMs = 0; PAUZE.edgeNeclarMs = 0; PAUZE.reluareMareMs = 0
ceas.dormi = () => Promise.resolve()

// PDF minimal valid (ASCII), o pagină per text
function pdfMinimal(texte: string[]): Uint8Array {
  const ob: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${texte.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${texte.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  texte.forEach((t, i) => {
    const s = t ? `BT /F1 10 Tf 12 TL 50 750 Td ${t.split('\n').map(l => `(${l}) Tj T*`).join(' ')} ET` : ''   // o linie pe rând (\n)
    ob.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`)
    ob.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`)
  })
  let out = '%PDF-1.4\n'
  const off: number[] = []
  ob.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const x = out.length
  out += `xref\n0 ${ob.length + 1}\n0000000000 65535 f \n${off.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${ob.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`
  return new TextEncoder().encode(out)
}
const TEXT = pdfMinimal([1, 2].map(i => `Caiet de sarcini pagina ${i}: conducta PE100 SDR11 Dn110\nmontata in sant deschis la adancimea minima de 0.9 m,\npe pat de nisip de 10 cm, cu banda avertizoare galbena\nsi fir trasor; proba de presiune conform NTPEE-2018 cap. ${i}`))
const SCAN = pdfMinimal(['a', 'b'])   // sub pragul de text pe pagină → „scan” → predat la edge

// ---- BD simulată + garda simulată (tokenuri) ----
type Opt = { garda?: 'continua' | 'in_curs' | 'eroare' | 'fara_token'; rezultatEsueaza?: boolean; blobAruncă?: boolean; updateAruncă?: 'in_lucru' | null; updateEroare?: 'final' | null }
function mediu(docs: any[], fisiere: Record<string, Uint8Array | { mare: number }>, opt: Opt = {}, garzi: any[] = []) {
  const tabele: Record<string, any[]> = { ofertare_documente_atribuire: docs, ai_usage_log: [], ofertare_ingest_garda: garzi, ofertare_ingest_lansari: [],
    ofertare_ingest_coada: [], notifications: [], ofertare_licitatii: [], ofertare_seap_manifest: [] }
  const g = { incercari: [] as number[], emise: new Map<string, number>(), rezultate: [] as any[], descarcari: [] as string[] }
  const from = (t: string) => {
    tabele[t] ||= []
    const filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    const pot = () => tabele[t].filter(r => filtre.every(f => f(r)))
    const b: any = {
      select: () => b, order: () => b, limit: () => b, not: () => b, like: () => b, or: () => b,
      eq: (c: string, v: unknown) => { if (!c.includes('->')) filtre.push(r => String(r[c]) === String(v)); return b },
      neq: (c: string, v: unknown) => { filtre.push(r => String(r[c]) !== String(v)); return b },
      in: (c: string, v: unknown[]) => { filtre.push(r => v.map(String).includes(String(r[c]))); return b },
      is: () => b,
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(pot()[0] ?? null), error: null }),
      then: (ok: any, ko: any) => new Promise((res, rej) => {
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire') {
          if (opt.updateAruncă === 'in_lucru' && op.patch.status_procesare === 'in_lucru') return rej(new Error('BD: conexiune pierdută la update'))
          if (opt.updateEroare === 'final' && ['procesat', 'partial'].includes(op.patch.status_procesare)) return res({ data: null, error: { message: 'constrângere încălcată' } })
        }
        if (op.tip === 'ins') { tabele[t].push(structuredClone(op.patch)); return res({ data: null, error: null }) }
        const rows = pot()
        if (op.tip === 'upd') for (const r of rows) Object.assign(r, structuredClone(op.patch))
        res({ data: structuredClone(rows), error: null })
      }).then(ok, ko),
    }
    return b
  }
  const rpc = (nume: string, a: any) => {
    if (nume === 'ofertare_doc_de_citit') return Promise.resolve({ data: true, error: null })
    if (nume === 'ofertare_ingest_garda_incearca') {
      g.incercari.push(a.p_doc_id)
      if (opt.garda === 'eroare') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
      if (opt.garda === 'in_curs') return Promise.resolve({ data: { actiune: 'in_curs', motiv: 'altă încercare', pana_la: '2026-09-30T10:10:00Z' }, error: null })
      if (opt.garda === 'fara_token') return Promise.resolve({ data: { actiune: 'continua', descarcari: 1 }, error: null })
      const token = crypto.randomUUID(); g.emise.set(token, a.p_doc_id)
      return Promise.resolve({ data: { actiune: 'continua', token, descarcari: 1, incercari_esuate: 0 }, error: null })
    }
    if (nume === 'ofertare_ingest_garda_rezultat') {
      g.rezultate.push(structuredClone(a))
      if (opt.rezultatEsueaza) return Promise.reject(new Error('rețea: rezultat pierdut'))
      return Promise.resolve({ data: { acceptat: g.emise.get(a.p_token) === a.p_doc_id }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  const storage = { from: () => ({
    list: (_d: string, o: any) => Promise.resolve({ data: [{ name: o.search, metadata: { size: 1234, eTag: '"e1"' } }], error: null }),
    download: (p: string) => {
      g.descarcari.push(p)
      const f = fisiere[p]
      if (!f) return Promise.resolve({ data: null, error: { message: 'Object not found' } })
      if (opt.blobAruncă) return Promise.resolve({ data: { arrayBuffer: () => Promise.reject(new Error('flux întrerupt la citirea blob-ului')) }, error: null })
      const bytes = f instanceof Uint8Array ? f : new Uint8Array((f as { mare: number }).mare)
      return Promise.resolve({ data: new Blob([bytes as BlobPart]), error: null })
    },
    createSignedUrl: () => Promise.resolve({ data: null, error: { message: 'fără URL semnat în test' } }),
  }) }
  // invarianta: fiecare token emis are EXACT un _rezultat; niciun _rezultat cu token neemis
  const exactOnce = () => {
    const pe = new Map<string, number>()
    for (const r of g.rezultate) pe.set(r.p_token, (pe.get(r.p_token) ?? 0) + 1)
    return [...g.emise.keys()].every(t => pe.get(t) === 1) && [...pe.keys()].every(t => g.emise.has(t))
  }
  return { supa: { from, rpc, storage } as any, tabele, g, exactOnce }
}
const doc = (id: number, o: any = {}) => ({ id, licitatie_id: 7, fisier_path: `7/atribuire/${id}.pdf`, nume_original: `Doc ${id}.pdf`, tip: 'cs_volum',
  status_procesare: 'neprocesat', eroare: null, size_bytes: 1000, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null, ...o })
const Z = { sanitizeOps: false, sanitizeResources: false }

Deno.test({ ...Z, name: 'text local reușit → EXACT un _rezultat „succes” (sha256 + mărime + etag)', fn: async () => {
  const m = mediu([doc(1)], { '7/atribuire/1.pdf': TEXT })
  const rez = await citesteDocument(m.supa, doc(1), 'u-1')
  assertMatch(rez, /^procesat \(2 pagini, text local/)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.length, 1)
  assertEquals(m.g.rezultate[0].p_rezultat, 'succes'); assertEquals(m.g.rezultate[0].p_size, TEXT.length); assertEquals(m.g.rezultate[0].p_etag, '"e1"')
  assertMatch(m.g.rezultate[0].p_hash, /^[0-9a-f]{64}$/)
} })

Deno.test({ ...Z, name: 'download eșuat → EXACT un „esec”', fn: async () => {
  const m = mediu([doc(2)], {})
  assertEquals(await citesteDocument(m.supa, doc(2), null), 'eroare: download')
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /^download: Object not found/)
} })

Deno.test({ ...Z, name: 'EXCEPȚIE la citirea blob-ului (după „continua”) → EXACT un „esec” cu mesajul excepției; excepția ajunge la apelant', fn: async () => {
  const m = mediu([doc(3)], { '7/atribuire/3.pdf': TEXT }, { blobAruncă: true })
  await assertRejects(() => citesteDocument(m.supa, doc(3), null), Error, 'flux întrerupt')
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /^excepție: flux întrerupt/)
} })

Deno.test({ ...Z, name: 'EXCEPȚIE din pdfinfo/pdftotext (Deno.Command aruncă) → EXACT un „esec”', fn: async () => {
  const m = mediu([doc(4)], { '7/atribuire/4.pdf': TEXT })
  const orig = Object.getOwnPropertyDescriptor(Deno, 'Command')!
  Object.defineProperty(Deno, 'Command', { configurable: true, value: class { constructor() { throw new Error('pdftotext: spawn ENOMEM') } } })
  try { await assertRejects(() => citesteDocument(m.supa, doc(4), null), Error, 'ENOMEM') } finally { Object.defineProperty(Deno, 'Command', orig) }
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /excepție: pdftotext: spawn ENOMEM/)
} })

Deno.test({ ...Z, name: 'EXCEPȚIE din BD (update in_lucru aruncă) → EXACT un „esec”', fn: async () => {
  const m = mediu([doc(5)], { '7/atribuire/5.pdf': TEXT }, { updateAruncă: 'in_lucru' })
  await assertRejects(() => citesteDocument(m.supa, doc(5), null), Error, 'conexiune pierdută')
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec'])
} })

Deno.test({ ...Z, name: 'update final cu eroare → EXACT un „esec” (explicit)', fn: async () => {
  const m = mediu([doc(6)], { '7/atribuire/6.pdf': TEXT }, { updateEroare: 'final' })
  assertMatch(await citesteDocument(m.supa, doc(6), null), /^eroare: update constrângere/)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec'])
} })

Deno.test({ ...Z, name: 'scan → „predat” ÎNAINTE de apelul edge (lease eliberat, contoare neatinse), apoi edge-ul', fn: async () => {
  const m = mediu([doc(7)], { '7/atribuire/7.pdf': SCAN })
  const e0 = retea.edge
  assertMatch(await citesteDocument(m.supa, doc(7), null), /^procesat \(2\/2 pagini, AI\)/)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['predat']); assertEquals(retea.edge - e0, 1)
} })

Deno.test({ ...Z, name: 'mai mare de 60 MB după descărcare → „predat” la citire_mare; o eroare ulterioară NU mai trimite nimic', fn: async () => {
  const m = mediu([doc(8)], { '7/atribuire/8.pdf': { mare: 61 * 1024 * 1024 } })
  try { await citesteDocument(m.supa, doc(8), null) } catch (_) { /* citire_mare pe BD simulată: indiferent */ }
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['predat'])
  assertEquals(m.tabele.ofertare_documente_atribuire[0].size_bytes, 61 * 1024 * 1024)
} })

Deno.test({ ...Z, name: 'fără „continua” (in_curs / garda indisponibilă / „continua” fără token) → nicio descărcare, niciun rezultat', fn: async () => {
  for (const [mod, re] of [['in_curs', /^garda: in_curs/], ['eroare', /^garda: blocat — garda indisponibilă/], ['fara_token', /^garda: blocat — garda a răspuns „continua” fără token/]] as const) {
    const m = mediu([doc(9)], { '7/atribuire/9.pdf': TEXT }, { garda: mod })
    assertMatch(await citesteDocument(m.supa, doc(9), null), re)
    assertEquals(m.g.descarcari.length, 0); assertEquals(m.g.rezultate.length, 0)
  }
} })

Deno.test({ ...Z, name: 'RPC-ul _rezultat pică (rețea) → drumul se termină normal, o singură încercare de trimitere (lease-ul expiră → abandonat)', fn: async () => {
  const m = mediu([doc(10)], { '7/atribuire/10.pdf': TEXT }, { rezultatEsueaza: true })
  assertMatch(await citesteDocument(m.supa, doc(10), null), /^procesat/)
  assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['succes'])
} })

Deno.test({ ...Z, name: 'proceseazaIngest: candidații cu lease activ / blocați / în backoff NU se ating; lease expirat = candidat; excepția → doc „eroare” + „esec”', fn: async () => {
  const viitor = new Date(Date.now() + 5 * 60_000).toISOString(), trecut = new Date(Date.now() - 60_000).toISOString()
  const docs = [doc(21), doc(22), doc(23), doc(24), doc(25)]
  const m = mediu(docs, Object.fromEntries(docs.map(d => [d.fisier_path, TEXT])), {}, [
    { doc_id: 21, blocat: false, urmatoarea_dupa: null, incercare_token: 'x', in_curs_pana: viitor },
    { doc_id: 22, blocat: true, urmatoarea_dupa: null, incercare_token: null, in_curs_pana: null },
    { doc_id: 23, blocat: false, urmatoarea_dupa: viitor, incercare_token: null, in_curs_pana: null },
    { doc_id: 24, blocat: false, urmatoarea_dupa: null, incercare_token: 'y', in_curs_pana: trecut },
  ])
  m.tabele.ofertare_ingest_coada.push({ licitatie_id: 7, activ: true, cerut_de: null, lansari: 0 })
  await proceseazaIngest(m.supa, 7, () => false, () => {})
  assertEquals(m.g.incercari.sort(), [24, 25])
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['succes', 'succes'])
  // excepție pe drum (blob) în bucla de producție: documentul → 'eroare', garda → exact un 'esec'
  const m2 = mediu([doc(26)], { '7/atribuire/26.pdf': TEXT }, { blobAruncă: true })
  m2.tabele.ofertare_ingest_coada.push({ licitatie_id: 7, activ: true, cerut_de: null, lansari: 0 })
  await proceseazaIngest(m2.supa, 7, () => false, () => {})
  assert(m2.exactOnce()); assertEquals(m2.g.rezultate.map(r => r.p_rezultat), ['esec'])
  assertEquals(m2.tabele.ofertare_documente_atribuire[0].status_procesare, 'eroare')
  assertMatch(m2.tabele.ofertare_documente_atribuire[0].eroare, /^eroare: flux întrerupt/)
} })
