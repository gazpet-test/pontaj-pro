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

const retea = { edge: 0, anthropic: 0, edgeRasp: null as null | ((docId: number) => Response) }
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('data:')) return fetchReal(input, init)
  if (u === `${URL_SB}/functions/v1/ofertare-ingest-doc`) {
    retea.edge++
    if (retea.edgeRasp) return Promise.resolve(retea.edgeRasp(JSON.parse(init.body).doc_id))
    return Promise.resolve(new Response(JSON.stringify({ ok: true, doc_id: JSON.parse(init.body).doc_id, pagini: 2, pagini_procesate: 2, status: 'procesat', continua: false }), { status: 200 }))
  }
  if (u.startsWith('https://api.anthropic.com/')) { retea.anthropic++; return Promise.resolve(new Response(JSON.stringify({ error: { message: 'fără AI în test' } }), { status: 500 })) }
  return Promise.reject(new Error(`rețea interzisă în test: ${u}`))
}) as typeof fetch

const { citesteDocument, proceseazaIngest, PAUZE, ceas, TERMENE, _mare } = await import(new URL('./ingest.ts', import.meta.url).href)
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
type Opt = { cas?: boolean; laAgatare?: () => void; marcajAgataDupa?: number; preluatDupaAgatare?: boolean; garda?: 'continua' | 'in_curs' | 'eroare' | 'fara_token'; rezultatEsueaza?: boolean; blobAruncă?: boolean; marcajRespins?: boolean; respinge?: boolean; downloadAgata?: boolean }
// căi JSON (analiza->citire_mare->>rev) ca în PostgREST — folosite doar cu opt.cas (CAS-ul real din citire_mare.ts)
const caleJson = (row: any, c: string) => { let v = row; for (const p of c.split(/->>?/)) v = v == null ? undefined : v[p]; return c.includes('->>') ? (v == null ? null : String(v)) : v }
const likeRe = (p: string) => new RegExp('^' + p.split('%').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's')
function mediu(docs: any[], fisiere: Record<string, Uint8Array | { mare: number }>, opt: Opt = {}, garzi: any[] = []) {
  const tabele: Record<string, any[]> = { ofertare_documente_atribuire: docs, ai_usage_log: [], ofertare_ingest_garda: garzi, ofertare_ingest_lansari: [],
    ofertare_ingest_coada: [], notifications: [], ofertare_licitatii: [], ofertare_seap_manifest: [] }
  const g = { incercari: [] as number[], surse: [] as string[], emise: new Map<string, number>(), rezultate: [] as any[], descarcari: [] as string[], scrieriDirecte: [] as any[], marcaje: [] as any[], cas: [] as any[], inZbor: 0, maxInZbor: 0 }
  const from = (t: string) => {
    tabele[t] ||= []
    const filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    const pot = () => tabele[t].filter(r => filtre.every(f => f(r)))
    const b: any = {
      select: () => b, order: () => b, limit: () => b, or: () => b,
      like: (c: string, p: string) => { filtre.push(r => likeRe(p).test(String(r[c] ?? ''))); return b },
      not: (c: string, o: string, p: string) => { filtre.push(r => !(o === 'like' && likeRe(p).test(String(r[c] ?? '')))); return b },
      eq: (c: string, v: unknown) => { if (!c.includes('->')) filtre.push(r => String(r[c]) === String(v)); else if (opt.cas) filtre.push(r => String(caleJson(r, c)) === String(v)); return b },
      neq: (c: string, v: unknown) => { filtre.push(r => String(r[c]) !== String(v)); return b },
      in: (c: string, v: unknown[]) => { filtre.push(r => v.map(String).includes(String(r[c]))); return b },
      is: (c: string, v: unknown) => { if (opt.cas) filtre.push(r => (caleJson(r, c) ?? null) === v); return b },
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(pot()[0] ?? null), error: null }),
      then: (ok: any, ko: any) => new Promise((res, rej) => {
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire') g.scrieriDirecte.push(structuredClone(op.patch))
        if (op.tip === 'ins') { tabele[t].push(structuredClone(op.patch)); return res({ data: null, error: null }) }
        const rows = pot()
        if (op.tip === 'upd' && t === 'ofertare_documente_atribuire') g.cas.push({ cm: structuredClone(op.patch?.analiza?.citire_mare ?? null), status: op.patch?.status_procesare, randuri: rows.length })
        if (op.tip === 'upd') for (const r of rows) Object.assign(r, structuredClone(op.patch))
        res({ data: structuredClone(rows), error: null })
      }).then(ok, ko),
    }
    return b
  }
  const rpc = (nume: string, a: any) => {
    if (nume === 'ofertare_doc_de_citit') return Promise.resolve({ data: true, error: null })
    if (nume === 'ofertare_ingest_garda_incearca') {
      g.incercari.push(a.p_doc_id); g.surse.push(a.p_sursa)
      if (opt.garda === 'eroare') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
      if (opt.garda === 'in_curs') return Promise.resolve({ data: { actiune: 'in_curs', motiv: 'altă încercare', pana_la: '2026-09-30T10:10:00Z' }, error: null })
      if (opt.garda === 'fara_token') return Promise.resolve({ data: { actiune: 'continua', descarcari: 1 }, error: null })
      const token = crypto.randomUUID(); g.emise.set(token, a.p_doc_id)
      return Promise.resolve({ data: { actiune: 'continua', token, descarcari: 1, incercari_esuate: 0 }, error: null })
    }
    if (nume === 'ofertare_ingest_garda_rezultat') {
      ;(a.p_rezultat === 'marcaj' ? g.marcaje : g.rezultate).push(structuredClone(a))
      if (a.p_rezultat === 'marcaj' && opt.marcajAgataDupa != null && g.marcaje.length > opt.marcajAgataDupa) {
        g.inZbor++; g.maxInZbor = Math.max(g.maxInZbor, g.inZbor)
        if (opt.preluatDupaAgatare) g.emise.set(a.p_token, -2)   // lease expirat, B a preluat documentul
        opt.laAgatare?.()
        return new Promise(() => {})   // heartbeat fără răspuns
      }
      if (opt.rezultatEsueaza && a.p_rezultat !== 'marcaj') return Promise.reject(new Error('rețea: rezultat pierdut'))
      // serverul: token activ ⇒ scrie p_doc ATOMIC; respins ⇒ documentul neatins (runda 3, J2)
      const ok = g.emise.get(a.p_token) === a.p_doc_id && !(a.p_rezultat === 'marcaj' ? opt.marcajRespins : opt.respinge)
      if (ok && a.p_doc) Object.assign(tabele.ofertare_documente_atribuire.find(r => r.id === a.p_doc_id) ?? {}, structuredClone(a.p_doc))
      if (ok && a.p_rezultat !== 'marcaj') g.emise.set(a.p_token, -1)   // închis: un al doilea raport ar fi „token vechi”
      return Promise.resolve({ data: { acceptat: ok, motiv: ok ? undefined : 'token vechi/străin' }, error: null })
    }
    return Promise.resolve({ data: null, error: null })
  }
  const storage = { from: () => ({
    list: (_d: string, o: any) => Promise.resolve({ data: [{ name: o.search, metadata: { size: 1234, eTag: '"e1"' } }], error: null }),
    download: (p: string) => {
      g.descarcari.push(p)
      if (opt.downloadAgata) return new Promise(() => {})
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
    for (const r of g.rezultate.filter(x => x.p_rezultat !== 'marcaj')) pe.set(r.p_token, (pe.get(r.p_token) ?? 0) + 1)
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
  assertEquals(await citesteDocument(m.supa, doc(2), null), 'eroare(salvat): download')
  assertEquals(m.tabele.ofertare_documente_atribuire[0].status_procesare, 'eroare'); assertEquals(m.g.scrieriDirecte.length, 0)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /^download: Object not found/)
} })

Deno.test({ ...Z, name: 'EXCEPȚIE la citirea blob-ului (după „continua”) → EXACT un „esec” cu mesajul excepției; excepția ajunge la apelant', fn: async () => {
  const m = mediu([doc(3)], { '7/atribuire/3.pdf': TEXT }, { blobAruncă: true })
  assertMatch(await citesteDocument(m.supa, doc(3), null), /^eroare\(salvat\): flux întrerupt/)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /^excepție: flux întrerupt/)
  assertEquals(m.tabele.ofertare_documente_atribuire[0].status_procesare, 'eroare'); assertEquals(m.g.scrieriDirecte.length, 0)
} })

Deno.test({ ...Z, name: 'EXCEPȚIE din pdfinfo/pdftotext (Deno.Command aruncă) → EXACT un „esec”', fn: async () => {
  const m = mediu([doc(4)], { '7/atribuire/4.pdf': TEXT })
  const orig = Object.getOwnPropertyDescriptor(Deno, 'Command')!
  Object.defineProperty(Deno, 'Command', { configurable: true, value: class { constructor() { throw new Error('pdftotext: spawn ENOMEM') } } })
  try { assertMatch(await citesteDocument(m.supa, doc(4), null), /^eroare\(salvat\): pdftotext: spawn ENOMEM/) } finally { Object.defineProperty(Deno, 'Command', orig) }
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec']); assertMatch(m.g.rezultate[0].p_eroare, /excepție: pdftotext: spawn ENOMEM/)
} })

Deno.test({ ...Z, name: 'J2: marcajul in_lucru respins (token preluat) → documentul NEATINS, nicio scriere directă', fn: async () => {
  const m = mediu([doc(5)], { '7/atribuire/5.pdf': TEXT }, { marcajRespins: true })
  assertMatch(await citesteDocument(m.supa, doc(5), null), /^garda: lease pierdut/)
  assertEquals(m.tabele.ofertare_documente_atribuire[0].status_procesare, 'neprocesat'); assertEquals(m.g.scrieriDirecte.length, 0)
  assert(m.exactOnce())
} })

Deno.test({ ...Z, name: 'J2 (Jakarinos): încercarea veche salvează DUPĂ preluare → serverul respinge, textul NU e suprascris', fn: async () => {
  const m = mediu([doc(6, { status_procesare: 'procesat', text_extras: 'TEXT NOU (B)' })], { '7/atribuire/6.pdf': TEXT }, { respinge: true })
  assertMatch(await citesteDocument(m.supa, doc(6), null), /^garda: rezultat NECONFIRMAT/)
  assertEquals(m.tabele.ofertare_documente_atribuire[0].text_extras, 'TEXT NOU (B)'); assertEquals(m.g.scrieriDirecte.length, 0)
} })

Deno.test({ ...Z, name: 'J2: download agățat → termen executabil (sub lease) → „esec” + documentul „eroare”, scris sub token', fn: async () => {
  const vechi = TERMENE.lucruLocalMs; TERMENE.lucruLocalMs = 50
  try {
    const m = mediu([doc(12)], { '7/atribuire/12.pdf': TEXT }, { downloadAgata: true })
    assertMatch(await citesteDocument(m.supa, doc(12), null), /^eroare\(salvat\): termen depășit: download/)
    assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec'])
    assertEquals(m.tabele.ofertare_documente_atribuire[0].status_procesare, 'eroare')
  } finally { TERMENE.lucruLocalMs = vechi }
  assert(TERMENE.lucruLocalMs < 10 * 60_000)
} })

Deno.test({ ...Z, name: 'scan → „predat” ÎNAINTE de apelul edge (lease eliberat, contoare neatinse), apoi edge-ul', fn: async () => {
  const m = mediu([doc(7)], { '7/atribuire/7.pdf': SCAN })
  const e0 = retea.edge
  assertMatch(await citesteDocument(m.supa, doc(7), null), /^gestionat: procesat \(2\/2 pagini, AI\)/)
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['predat']); assertEquals(retea.edge - e0, 1)
} })

Deno.test({ ...Z, name: 'mai mare de 60 MB după descărcare → „predat” la citire_mare; o eroare ulterioară NU mai trimite nimic', fn: async () => {
  const m = mediu([doc(8)], { '7/atribuire/8.pdf': { mare: 61 * 1024 * 1024 } })
  try { await citesteDocument(m.supa, doc(8), null) } catch (_) { /* citire_mare pe BD simulată: indiferent */ }
  // runda 3 (J3): după predare, citirea pe felii își ia PROPRIA încercare (token 2), închisă și ea o singură dată
  assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['predat', 'esec']); assertEquals(m.g.surse, ['nas:ingest', 'nas:citire_mare'])
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
  // runda 3: fără confirmarea serverului NU pretindem „salvat” (documentul e scris doar de RPC-ul care a picat)
  assertMatch(await citesteDocument(m.supa, doc(10), null), /^garda: rezultat NECONFIRMAT \(fără răspuns\)/)
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
  assertEquals(m2.g.scrieriDirecte.filter(p => p.status_procesare === 'eroare').length, 0)   // scris doar sub token
} })

Deno.test({ ...Z, name: 'J3 (Jakarinos): PDF > 60 MB intră pe felii DOAR prin gardă — in_curs (alt worker descarcă) ⇒ fără URL semnat/descărcare', fn: async () => {
  const mare = doc(40, { size_bytes: 99_000_000, status_procesare: 'ignorat', eroare: 'prea mare pentru citirea automată (95 MB > 60 MB)' })
  let semnate = 0
  const m = mediu([mare], {}, { garda: 'in_curs' })
  const st0 = m.supa.storage.from(); m.supa.storage.from = () => ({ ...st0, createSignedUrl: () => { semnate++; return st0.createSignedUrl() } })
  assertMatch(await citesteDocument(m.supa, mare, null), /^garda: in_curs/)
  assertEquals(semnate, 0); assertEquals(m.g.surse, ['nas:citire_mare'])
  const m2 = mediu([structuredClone(mare)], {})
  await citesteDocument(m2.supa, mare, null)
  assert(m2.exactOnce()); assertEquals(m2.g.surse, ['nas:citire_mare']); assertEquals(m2.g.rezultate.length, 1)
} })

Deno.test({ ...Z, name: 'J4 (Jakarinos): Word din worker trece prin gardă — corupt ⇒ „esec” (se numără spre blocare); in_curs ⇒ fără descărcare', fn: async () => {
  const w = { id: 50, licitatie_id: 7, nume_original: 'Formular.docx', tip: 'formular', fisier_path: '7/atribuire/50.docx', status_procesare: 'ignorat', text_extras: null }
  const m = mediu([w], { '7/atribuire/50.docx': new TextEncoder().encode('nu e zip') })
  m.tabele.ofertare_ingest_coada.push({ licitatie_id: 7, activ: true, cerut_de: null, lansari: 0 })
  await proceseazaIngest(m.supa, 7, () => false, () => {})
  assertEquals(m.g.surse, ['nas:word']); assert(m.exactOnce()); assertEquals(m.g.rezultate.map(r => r.p_rezultat), ['esec'])
  assertEquals(m.g.scrieriDirecte.length, 0)
  const m2 = mediu([structuredClone(w)], { '7/atribuire/50.docx': new TextEncoder().encode('nu e zip') }, { garda: 'in_curs' })
  m2.tabele.ofertare_ingest_coada.push({ licitatie_id: 7, activ: true, cerut_de: null, lansari: 0 })
  await proceseazaIngest(m2.supa, 7, () => false, () => {})
  assertEquals(m2.g.descarcari.length, 0)
} })

Deno.test({ ...Z, name: 'Copilot r3 #1: A predat → B are token + marcaj in_lucru → A primește eroare din aval ⇒ statusul rămâne al lui B, A nu scrie NIMIC', fn: async () => {
  const d = doc(60)
  const m = mediu([d], { '7/atribuire/60.pdf': SCAN })
  m.tabele.ofertare_ingest_coada.push({ licitatie_id: 7, activ: true, cerut_de: null, lansari: 0 })
  retea.edgeRasp = (id) => {   // în aval: B ia token și își marchează documentul, apoi A vede o eroare
    Object.assign(m.tabele.ofertare_documente_atribuire.find(r => r.id === id)!, { status_procesare: 'in_lucru', procesat_de: 'B' })
    return new Response(JSON.stringify({ error: 'Claude paginile 1-2: overloaded' }), { status: 200 })
  }
  try { await proceseazaIngest(m.supa, 7, () => false, () => {}) } finally { retea.edgeRasp = null }
  const r = m.tabele.ofertare_documente_atribuire[0]
  assertEquals([r.status_procesare, r.procesat_de], ['in_lucru', 'B'])
  assertEquals(m.g.scrieriDirecte.length, 0)
  assertEquals(m.g.rezultate.map(x => x.p_rezultat), ['predat'])
} })

Deno.test({ ...Z, name: 'Copilot r3 #2: heartbeat serializat — #1 OK, #2 fără răspuns, B preia ⇒ A se oprește, NU raportează procesat, nicio scriere', fn: async () => {
  const vechi = { ...PAUZE }, orig = _mare.citesteMare
  PAUZE.leaseReinnoireMs = 5; PAUZE.marcajTermenMs = 30
  const mare = doc(61, { size_bytes: 99_000_000 })
  const m = mediu([mare], {}, { marcajAgataDupa: 1, preluatDupaAgatare: true })
  let feliiDupaOprire = 0
  _mare.citesteMare = async (_s: any, _id: number, deps: any) => {
    for (let i = 0; i < 200; i++) { if (deps.esteOprire()) return 'întrerupt: workerul se oprește'; await new Promise(r => setTimeout(r, 2)) ; feliiDupaOprire += deps.esteOprire() ? 1 : 0 }
    return 'procesat (60 pagini, pe felii)'
  }
  try {
    const rez = await citesteDocument(m.supa, mare, null)
    assertMatch(rez, /^gestionat: garda: lease pierdut/)
    assert(!/^gestionat: (procesat|partial)/.test(rez))
    assertEquals(m.g.marcaje.length, 2)          // #1 acceptat, #2 agățat — niciun al treilea cât #2 e în zbor
    assertEquals(m.g.maxInZbor, 1)
    assertEquals(m.g.scrieriDirecte.length, 0); assertEquals(m.tabele.ofertare_documente_atribuire[0].status_procesare, 'neprocesat')
    assert(m.g.rezultate.every(x => x.p_rezultat !== 'succes'))
  } finally { Object.assign(PAUZE, vechi); _mare.citesteMare = orig }
} })

Deno.test({ ...Z, name: 'Copilot r3 #3: > 60 MB după descărcare ⇒ size_bytes scris ATOMIC cu predarea, fără UPDATE direct', fn: async () => {
  const orig = _mare.citesteMare
  _mare.citesteMare = async () => 'sărit: test'
  try {
    const m = mediu([doc(62)], { '7/atribuire/62.pdf': { mare: 61 * 1024 * 1024 } })
    await citesteDocument(m.supa, doc(62), null)
    assertEquals(m.g.scrieriDirecte.length, 0)
    assertEquals(m.g.rezultate[0].p_doc, { size_bytes: 61 * 1024 * 1024 })
    assertEquals(m.tabele.ofertare_documente_atribuire[0].size_bytes, 61 * 1024 * 1024)
  } finally { _mare.citesteMare = orig }
} })

// Copilot (neblocant, după r4): același scenariu ca r3 #2, dar pe citesteMare REAL din citire_mare.ts (CAS pe
// analiza->citire_mare->>rev), nu pe citirea simulată. A pornește sub gardă, heartbeat #2 nu răspunde, lease-ul expiră,
// B preia și pornește PROPRIA citire (citesteMare real ⇒ rescrie rev-ul); orice scriere ulterioară a lui A (întreruperea
// la felia următoare SAU rezultatul final) e refuzată de CAS; progresul lui B rămâne; A nu raportează procesat/parțial.
// citire_mare.ts nu scrie pe felie (doar marcajul de început, întreruperea și finalul) — acestea sunt scrierile lui A.
const { citesteMare: citesteMareReal } = await import(new URL('./citire_mare.ts', import.meta.url).href)
async function scenariuPreluareReala(asteaptaPierdut: boolean) {
  const vechi = { ...PAUZE }
  PAUZE.leaseReinnoireMs = 5; PAUZE.marcajTermenMs = asteaptaPierdut ? 30 : 400
  const id = 70 + (asteaptaPierdut ? 0 : 1)
  const mare = doc(id, { size_bytes: TEXT.length, status_procesare: 'ignorat', eroare: 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS' })
  let bPornit!: () => void, elibereazaB!: () => void
  const bInCitire = new Promise<void>(r => { bPornit = r }), bLiber = new Promise<void>(r => { elibereazaB = r })
  let promB: Promise<string> | null = null
  const m = mediu([mare], { [mare.fisier_path]: TEXT }, {
    cas: true, marcajAgataDupa: 1, preluatDupaAgatare: true,
    // lease expirat ⇒ B preia documentul (token nou) și pornește citirea pe felii reală; se blochează la prima felie
    laAgatare: () => { promB ??= citesteMareReal(m.supa, id, { cerutDe: 'B', pagini: async () => ({ nPag: 2 }),
      extractor: () => async (de: number, la: number) => { bPornit(); await bLiber; return { ok: true, pagini: Array.from({ length: la - de + 1 }, (_, i) => `B pagina ${de + i} `.repeat(10)) } } }) },
  })
  const st0 = m.supa.storage.from()
  const url = 'data:application/pdf;base64,' + btoa(String.fromCharCode(...TEXT))
  let semnate = 0
  m.supa.storage.from = () => ({ ...st0, createSignedUrl: async () => {
    // A (primul URL semnat) descarcă abia după ce B a preluat și a intrat în citire (+ după expirarea termenului heartbeat-ului)
    if (semnate++ === 0) { await bInCitire; if (asteaptaPierdut) await new Promise(r => setTimeout(r, 120)) }
    return { data: { signedUrl: url }, error: null }
  } })
  try {
    const rez = await citesteDocument(m.supa, mare, 'A')
    const cmB = structuredClone(m.tabele.ofertare_documente_atribuire[0].analiza.citire_mare)
    return { m, rez, cmB, promB: promB!, elibereazaB }
  } finally { Object.assign(PAUZE, vechi) }
}

for (const asteaptaPierdut of [true, false]) Deno.test({ ...Z, name: `Copilot neblocant: preluare REALĂ pe citire_mare.ts — ${asteaptaPierdut ? 'A vede lease-ul pierdut ⇒ scrierea de întrerupere' : 'A termină citirea ⇒ scrierea finală „gata”'} refuzată de CAS, progresul lui B rămâne`, fn: async () => {
  const { m, rez, cmB, promB, elibereazaB } = await scenariuPreluareReala(asteaptaPierdut)
  const d = m.tabele.ofertare_documente_atribuire[0]
  // scrierile: #0 = marcajul de început al lui A (rev A); #1 = marcajul lui B peste (rev B); tot ce scrie A după e refuzat
  const [a0, b0, ...dupa] = m.g.cas
  assertEquals([a0.randuri, a0.cm.stare, a0.cm.incercari], [1, 'in_curs', 1])
  assertEquals([b0.randuri, b0.cm.stare, b0.cm.incercari], [1, 'in_curs', 2]); assert(b0.cm.rev !== a0.cm.rev)
  assert(dupa.length >= 1, 'A trebuie să fi încercat o scriere după preluare')
  for (const w of dupa) assertEquals(w.randuri, 0, `scrierea lui A (${w.cm?.stare}) trebuie refuzată de CAS`)
  assertEquals(dupa.map(w => w.cm.stare), asteaptaPierdut ? ['eroare'] : ['gata'])   // întreruperea / finalul lui A
  // progresul lui B rămâne intact: rev-ul, starea și autorul lui B
  assertEquals(cmB.rev, b0.cm.rev); assertEquals(cmB.stare, 'in_curs')
  assertEquals([d.status_procesare, d.procesat_de, d.text_extras], ['in_lucru', 'B', null])
  // A nu raportează procesat/parțial și garda nu primește „succes”
  assert(!/^gestionat: (procesat|partial)/.test(rez), rez)
  assertMatch(rez, asteaptaPierdut ? /^gestionat: garda: lease pierdut/ : /^gestionat: eroare: rezultatul nu s-a putut scrie/)
  assert(m.g.rezultate.every(x => x.p_rezultat !== 'succes'))
  // B își termină citirea: scrierea lui finală trece (CAS pe rev-ul lui), textul e al lui B
  elibereazaB()
  assertMatch(await promB, /^procesat \(2 pagini/)
  assertEquals(d.analiza.citire_mare.stare, 'gata'); assertEquals(d.analiza.citire_mare.incercari, 2)
  assertMatch(d.text_extras, /B pagina 1/); assertEquals(d.procesat_de, 'B')
} })

Deno.test('grep: după „continua” nu există NICIUN UPDATE direct pe ofertare_documente_atribuire (worker + edge, căile sub gardă)', () => {
  const W = Deno.readTextFileSync(new URL('./ingest.ts', import.meta.url))
  const corp = (nume: string) => { const i = W.indexOf(`function ${nume}(`); const j = W.indexOf('\n}\n', i); assert(i > 0 && j > i, nume); return W.slice(i, j) }
  const RE = /from\('ofertare_documente_atribuire'\)\s*\.update/
  for (const f of ['citesteDocument', 'citesteMareCuGarda', 'citesteDupaGarda']) assert(!RE.test(corp(f)), f)
  const word = corp('citesteWordLicitatie'); assert(!RE.test(word.slice(word.indexOf('gardaIncearca'))), 'word')
  const E = Deno.readTextFileSync(new URL('../../supabase/functions/ofertare-ingest-doc/index.ts', import.meta.url))
  assert(!RE.test(E.slice(E.indexOf('inc = incercareGarda('))), 'edge ingest-doc')
  const WT = Deno.readTextFileSync(new URL('../../supabase/functions/ofertare-word-text/index.ts', import.meta.url))
  assert(!RE.test(WT.slice(WT.indexOf('incercareGarda('))), 'edge word-text')
  // singurul UPDATE direct rămas în proceseazaIngest e pe drumul FĂRĂ token (trecereBlocata); rezultatele gestionate îl ocolesc
  const pi = corp('proceseazaIngest'); assert(pi.indexOf('rez.startsWith(GESTIONAT)') < pi.indexOf("update({ status_procesare: 'eroare'"))
})
