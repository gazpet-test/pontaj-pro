// deno test --node-modules-dir=none --no-lock --allow-env --allow-read --allow-write=/tmp --allow-run=pdftotext,pdfinfo worker/ofertare/ingest_mare_test.ts
// (--no-lock: altfel deno scrie în deno.lock din rădăcina repo-ului)
// R6 / doc 770 — bucla proceseazaIngest pe o BD simulată (fără Supabase real, fără AI: fetch-ul e interceptat):
//  (1) 770 'ignorat' de edge pe mărime intră pe drumul pe felii și iese citit, fără să atingă edge-ul;
//  (2) cauza reală a buclei (runda 2): edge-ul omorât de memorie răspundea 546 {code,message}, fără `error` → workerul
//      număra „citit” și îl relua de 5421 de ori. Acum orice răspuns fără ok:true e eroare cu motivul real;
//  (3) plasa: un document care tot rămâne candidat după o „citire” reușită e oprit la a doua trecere în aceeași tură;
//  (4) rollback-ul SQL (coada activ=false + documentul înapoi) oprește tura înainte de documentul următor.
// Importă ingest.ts (supabase-js, jszip, word-extractor de pe esm.sh) → prima rulare descarcă modulele.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'

const URL_SB = 'https://sb.test'
Deno.env.set('SUPABASE_URL', URL_SB)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test')
Deno.env.set('ANTHROPIC_API_KEY', 'k-test')

const apeluri = { edge: 0, anthropic: 0, peDoc: {} as Record<number, number> }
// exact ce întorcea edge-ul omorât de memorie: fără câmpul `error`, fără `ok`, fără `continua`
const WORKER_LIMIT = () => new Response(JSON.stringify({ code: 'WORKER_LIMIT', message: 'Memory limit exceeded' }), { status: 546 })
// răspunsul edge-ului pe doc_id (implicit WORKER_LIMIT); o funcție care aruncă = eroare de rețea
const raspEdge: Record<number, (n: number) => Response> = {}
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('data:')) return fetchReal(input, init)
  if (u === `${URL_SB}/functions/v1/ofertare-ingest-doc`) {
    const id = Number(JSON.parse(String(init?.body ?? '{}')).doc_id)
    apeluri.edge++; apeluri.peDoc[id] = (apeluri.peDoc[id] ?? 0) + 1
    try { return Promise.resolve((raspEdge[id] ?? WORKER_LIMIT)(apeluri.peDoc[id])) } catch (e) { return Promise.reject(e) }
  }
  if (u.startsWith('https://api.anthropic.com/')) { apeluri.anthropic++; return Promise.resolve(new Response(JSON.stringify({ error: { message: 'fără AI în test' } }), { status: 500 })) }
  return Promise.reject(new Error(`rețea interzisă în test: ${u}`))
}) as typeof fetch

// specificator calculat: ingest.ts nu intră în type-check-ul testului (are erori vechi de tipare supabase-js „never”,
// iar workerul rulează cu `deno run`, fără type-check) — se încarcă doar la rulare, după ce fetch-ul e interceptat
const { proceseazaIngest, citesteCuAI, motivRaspunsEdge, PAUZE } = await import(new URL('./ingest.ts', import.meta.url).href)
PAUZE.edgeMs = 0; PAUZE.reluareMareMs = 0   // fără pauzele de 15/30 s dintre reîncercări
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })

// PDF minimal valid (ASCII), o pagină per text
function pdfMinimal(texte: string[]): Uint8Array {
  const ob: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${texte.map((_, i) => `${4 + 2 * i} 0 R`).join(' ')}] /Count ${texte.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  texte.forEach((t, i) => {
    const s = t ? `BT /F1 10 Tf 50 750 Td (${t}) Tj ET` : ''
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

// ---- BD simulată: doar operațiile folosite de proceseazaIngest / citesteMare ----
const cale = (row: any, c: string) => {
  let v = row
  for (const p of c.split(/->>?/)) v = v == null ? undefined : v[p]
  return c.includes('->>') ? (v == null ? null : String(v)) : v
}
const like = (pat: string, ci = false) => new RegExp('^' + pat.split('%').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', ci ? 'is' : 's')
function bd(tabele: Record<string, any[]>, fisiere: Record<string, Uint8Array>) {
  const from = (t: string) => {
    tabele[t] ||= []
    const filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    let lim = Infinity
    const pot = () => tabele[t].filter(r => filtre.every(f => f(r))).slice(0, lim)
    const b: any = {
      select: () => b, order: () => b, limit: (n: number) => { lim = n; return b },
      eq: (c: string, v: unknown) => { filtre.push(r => String(cale(r, c)) === String(v)); return b },
      neq: (c: string, v: unknown) => { filtre.push(r => String(cale(r, c)) !== String(v)); return b },
      is: (c: string, v: unknown) => { filtre.push(r => (cale(r, c) ?? null) === v); return b },
      in: (c: string, v: unknown[]) => { filtre.push(r => v.map(String).includes(String(cale(r, c)))); return b },
      like: (c: string, p: string) => { filtre.push(r => like(p).test(String(cale(r, c) ?? ''))); return b },
      not: (c: string, o: string, p: string) => { filtre.push(r => !(o === 'like' && like(p).test(String(cale(r, c) ?? '')))); return b },
      or: (s: string) => { const alt = s.split(',').map(x => x.split('.ilike.')); filtre.push(r => alt.some(([c, p]) => like(p, true).test(String(r[c] ?? '')))); return b },
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(pot()[0] ?? null), error: null }),
      then: (ok: any, ko: any) => Promise.resolve((() => {
        if (op.tip === 'ins') { tabele[t].push(structuredClone(op.patch)); return { data: null, error: null } }
        const rows = pot()
        if (op.tip === 'upd') for (const r of rows) Object.assign(r, structuredClone(op.patch))
        return { data: structuredClone(rows), error: null }
      })()).then(ok, ko),
    }
    return b
  }
  const rpc = (nume: string, a: any) => Promise.resolve({ data: nume === 'ofertare_doc_de_citit' ? (/\.pdf *\d*$/i.test(a.p_nume) && a.p_tip !== 'plansa') : null, error: null })
  const storage = { from: () => ({
    download: (p: string) => Promise.resolve(fisiere[p] ? { data: new Blob([fisiere[p] as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } }),
    createSignedUrl: (p: string) => Promise.resolve(fisiere[p] ? { data: { signedUrl: 'data:application/pdf;base64,' + btoa(String.fromCharCode(...fisiere[p])) }, error: null } : { data: null, error: { message: 'Object not found' } }),
  }) }
  return { from, rpc, storage }
}

const arePoppler = await (async () => { try { return (await new Deno.Command('pdftotext', { args: ['-v'], stderr: 'null', stdout: 'null' }).output()).success } catch { return false } })()

Deno.test({ name: 'proceseazaIngest: 770 (ignorat pe mărime) citit pe felii; documentul care rămâne candidat e oprit, nu buclează', ignore: !arePoppler, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const pdf770 = pdfMinimal(Array.from({ length: 30 }, (_, i) => i === 4 ? '' : `Studiu geotehnic Huedin pagina ${i + 1} foraj F${i + 1} argila prafoasa cafenie plastic vartoasa nivel hidrostatic ${i + 1} m`))
  const tabele: Record<string, any[]> = {
    ofertare_ingest_coada: [{ licitatie_id: 101, activ: true, cerut_de: 'u-razvan', lansari: 0 }],
    ofertare_ingest_lansari: [{ doc_id: 770, lansat_la: '2026-09-25T01:53:00Z', incercari: 4, pagini_la_lansare: 0 }],
    ofertare_licitatii: [{ id: 101, nr_anunt: 'CN-HUEDIN' }],
    notifications: [], ai_usage_log: [], ofertare_seap_manifest: [],
    ofertare_documente_atribuire: [
      { id: 770, licitatie_id: 101, fisier_path: '101/atribuire/770.pdf', nume_original: 'Documentatie tehnica HUEDIN Lot 1/Studiu geotehnic__Transgaz+Anexe.pdf',
        tip: 'alta', status_procesare: 'ignorat', eroare: 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS',
        size_bytes: pdf770.length, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null },
      // PDF stricat, sub prag: pdfinfo pică → drumul vechi, edge-ul (simulat) „moare” cu 546 WORKER_LIMIT, fără `error`
      { id: 900, licitatie_id: 101, fisier_path: '101/atribuire/900.pdf', nume_original: 'Anexa 3.pdf', tip: 'alta', status_procesare: 'neprocesat',
        eroare: null, size_bytes: 12, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null },
      // edge-ul răspunde ok:true, dar documentul rămâne 'neprocesat' în BD (patologic) → prins de plasa trecereBlocata
      { id: 901, licitatie_id: 101, fisier_path: '101/atribuire/901.pdf', nume_original: 'Anexa 4.pdf', tip: 'alta', status_procesare: 'neprocesat',
        eroare: null, size_bytes: 12, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null },
      // alt 'ignorat' (spart în bucăți) → nu se atinge
      { id: 153, licitatie_id: 101, fisier_path: '101/atribuire/153.pdf', nume_original: 'B.1-SF DESEN.pdf', tip: 'alta', status_procesare: 'ignorat',
        eroare: '77 MB — prea mare pentru citirea AI; spart de platformă în 10 bucăți', size_bytes: 76926168, analiza: null, text_extras: null },
    ],
  }
  const stricat = new TextEncoder().encode('nu e un PDF!')
  const supa: any = bd(tabele, { '101/atribuire/770.pdf': pdf770, '101/atribuire/900.pdf': stricat, '101/atribuire/901.pdf': stricat })
  raspEdge[901] = () => json({ ok: true, doc_id: 901, pagini: 1, pagini_procesate: 1, status: 'procesat', continua: false })
  const edge0 = apeluri.edge
  const t0 = Date.now()
  await proceseazaIngest(supa, 101, () => false, () => {})
  const d = (id: number) => tabele.ofertare_documente_atribuire.find(x => x.id === id)

  // (1) 770
  assertEquals(d(770).status_procesare, 'partial')
  assertEquals(d(770).pagini, 30); assertEquals(d(770).pagini_necitite, [5])
  assertMatch(d(770).text_extras, /^⟦PAGINA 1⟧\nStudiu geotehnic Huedin pagina 1/)
  assertEquals(d(770).analiza.citire_mare.stare, 'gata'); assertEquals(d(770).analiza.citire_mare.incercari, 1)
  assertEquals(d(770).procesat_de, 'u-razvan')
  // (2) 900: răspunsul 546 fără `error` e EROARE cu motivul real (3 apeluri: 1 + 2 reîncercări), nu „citit” — înainte:
  //     „gata (?/? pagini, AI)”, citite++ și buclă; motivul scris era „revine în coadă…”, nu cauza
  assertEquals(apeluri.peDoc[900], 3)
  assertEquals(d(900).status_procesare, 'eroare'); assertEquals(d(900).eroare, 'eroare: WORKER_LIMIT: Memory limit exceeded (HTTP 546)')
  // (3) 901: ok:true dar rămâne candidat → a doua trecere e oprită de plasă (fără al doilea apel la edge)
  assertEquals(apeluri.peDoc[901], 1); assertEquals(apeluri.edge - edge0, 4)
  assertEquals(d(901).status_procesare, 'eroare'); assertMatch(d(901).eroare, /revine în coadă după o trecere în aceeași tură/)
  // 153 neatins, coada închisă cu notă + notificare; 900 numărat la eșuate, nu la citite
  assertEquals(d(153).status_procesare, 'ignorat'); assertEquals(d(153).analiza, null)
  assertEquals(tabele.ofertare_ingest_coada[0].activ, false)
  assertMatch(tabele.ofertare_ingest_coada[0].nota, /1 parțiale, 2 cu eroare\/epuizate \(worker NAS: 2 citite acum, 2 eșuate\)/)
  assertEquals(tabele.notifications.length, 1)
  assert(Date.now() - t0 < 30_000)

  // a doua activare a cozii: nimic de făcut pe 770 (sărit fără scriere), 900 rămâne eroare → încă o trecere, apoi stop
  tabele.ofertare_ingest_coada[0].activ = true
  const inainte = JSON.stringify(d(770))
  await proceseazaIngest(supa, 101, () => false, () => {})
  assertEquals(JSON.stringify(d(770)), inainte)
  assertEquals(tabele.ofertare_ingest_coada[0].activ, false)
} })

Deno.test('citesteCuAI: DOAR ok:true e succes; orice alt răspuns = eroare cu motivul din error/message/code (+ HTTP)', async () => {
  const cazuri: Array<[number, (n: number) => Response, RegExp | string, number]> = [
    [1, () => json({ ok: true, doc_id: 1, pagini: 5, pagini_procesate: 5, status: 'partial', continua: false }), 'partial (5/5 pagini, AI)', 1],
    [2, (n) => json({ ok: true, pagini: 4, pagini_procesate: n * 2, status: n < 2 ? 'in_lucru' : 'procesat', continua: n < 2 }), 'procesat (4/4 pagini, AI)', 2],
    [3, () => json({ ok: true, skip: 'non-pdf', continua: false }), 'sărit: non-pdf', 1],
    [4, WORKER_LIMIT, 'eroare: WORKER_LIMIT: Memory limit exceeded (HTTP 546)', 3],
    [5, () => json({ error: 'document negasit' }, 404), 'eroare: document negasit (HTTP 404)', 3],
    [6, () => json({ error: 'Eroare neasteptata: x' }), 'eroare: Eroare neasteptata: x', 3],          // mesajul edge-ului, neschimbat
    [7, () => json({}), 'eroare: răspuns fără ok:true', 3],
    [8, () => new Response('', { status: 504 }), 'eroare: răspuns gol (HTTP 504)', 3],
    [9, () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502 }), /^eroare: răspuns ne-JSON: <html><body>502 Bad Gateway.* \(HTTP 502\)$/, 3],
    [10, () => json({ message: 'upstream request timeout' }, 504), 'eroare: upstream request timeout (HTTP 504)', 3],
    [11, () => { throw new TypeError('connection reset') }, 'eroare: apel edge: connection reset', 3],
    [12, () => json({ ok: false, status: 'procesat', continua: false }), 'eroare: răspuns fără ok:true', 3],
  ]
  for (const [id, r, asteptat, nApeluri] of cazuri) {
    raspEdge[id] = r
    const rez = await citesteCuAI(id)
    if (typeof asteptat === 'string') assertEquals(rez, asteptat, `doc ${id}`); else assertMatch(rez, asteptat)
    assertEquals(apeluri.peDoc[id], nApeluri, `apeluri la edge pentru doc ${id}`)
  }
  assertEquals(motivRaspunsEdge({ ok: true, status: 'procesat' }), null)
  assertEquals(motivRaspunsEdge(null, 0), 'răspuns gol')
})

Deno.test({ name: 'rollback în timpul citirii lui 770 (coada activ=false + documentul înapoi): 770 rămâne cum l-a pus rollback-ul, tura se oprește înainte de documentul următor, fără notă/notificare', ignore: !arePoppler, sanitizeOps: false, sanitizeResources: false, fn: async () => {
  const pdf770 = pdfMinimal(Array.from({ length: 6 }, (_, i) => `Studiu geotehnic Huedin pagina ${i + 1} foraj F${i + 1} argila prafoasa cafenie plastic vartoasa nivel hidrostatic ${i + 1} m`))
  const EROARE_EDGE = 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS'
  const tabele: Record<string, any[]> = {
    ofertare_ingest_coada: [{ licitatie_id: 101, activ: true, cerut_de: 'u-razvan', lansari: 0, nota: null }],
    ofertare_ingest_lansari: [], ofertare_licitatii: [{ id: 101, nr_anunt: 'CN-HUEDIN' }], notifications: [], ai_usage_log: [], ofertare_seap_manifest: [],
    ofertare_documente_atribuire: [
      { id: 770, licitatie_id: 101, fisier_path: '101/atribuire/770.pdf', nume_original: 'Studiu geotehnic__Transgaz+Anexe.pdf', tip: 'alta',
        status_procesare: 'ignorat', eroare: EROARE_EDGE, size_bytes: pdf770.length, pagini: null, pagini_procesate: 0, pagini_necitite: [], pagina_offset: 0, analiza: null, text_extras: null },
      { id: 905, licitatie_id: 101, fisier_path: '101/atribuire/905.pdf', nume_original: 'Anexa 5.pdf', tip: 'alta', status_procesare: 'neprocesat',
        eroare: null, size_bytes: 12, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null },
    ],
  }
  const supa: any = bd(tabele, { '101/atribuire/770.pdf': pdf770, '101/atribuire/905.pdf': new TextEncoder().encode('nu e un PDF!') })
  const d = (id: number) => tabele.ofertare_documente_atribuire.find(x => x.id === id)
  let rollback = false
  const edge0 = apeluri.edge
  await proceseazaIngest(supa, 101, () => false, (s: string) => {
    if (rollback || !/PDF mare .*paginile/.test(s)) return
    rollback = true   // pașii de rollback din SQL-ul R6, în ordinea documentată: întâi coada, apoi documentul
    Object.assign(tabele.ofertare_ingest_coada[0], { activ: false, nota: 'oprită manual (rollback R6/770)' })
    const x = d(770); delete x.analiza.citire_mare
    Object.assign(x, { status_procesare: 'ignorat', eroare: EROARE_EDGE, analiza: Object.keys(x.analiza).length ? x.analiza : null,
      text_extras: null, pagini: null, pagini_procesate: 0, pagini_necitite: [] })
  })
  assert(rollback, 'rollback-ul a avut loc în timpul feliilor')
  assertEquals([d(770).status_procesare, d(770).eroare, d(770).analiza, d(770).text_extras, d(770).pagini], ['ignorat', EROARE_EDGE, null, null, null])
  assertEquals(d(905).status_procesare, 'neprocesat'); assertEquals(apeluri.edge, edge0, '905 nu mai e trimis la edge')
  assertEquals(tabele.ofertare_ingest_coada[0].nota, 'oprită manual (rollback R6/770)'); assertEquals(tabele.ofertare_ingest_coada[0].activ, false)
  assertEquals(tabele.notifications.length, 0)
} })
