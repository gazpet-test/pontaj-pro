// deno test --node-modules-dir=none --allow-env --allow-read --allow-write=/tmp --allow-run=pdftotext,pdfinfo worker/ofertare/ingest_mare_test.ts
// R6 / doc 770 — bucla proceseazaIngest pe o BD simulată (fără Supabase real, fără AI: fetch-ul e interceptat):
//  (1) 770 'ignorat' de edge pe mărime intră pe drumul pe felii și iese citit, fără să atingă edge-ul;
//  (2) un document care rămâne candidat după „citire” (tiparul 770: edge-ul murea fără câmpul error → workerul număra
//      „citit” și îl relua de 5421 de ori) e oprit la a doua trecere în aceeași tură.
// Importă ingest.ts (supabase-js, jszip, word-extractor de pe esm.sh) → prima rulare descarcă modulele.
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1'

const URL_SB = 'https://sb.test'
Deno.env.set('SUPABASE_URL', URL_SB)
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-test')
Deno.env.set('ANTHROPIC_API_KEY', 'k-test')

const apeluri = { edge: 0, anthropic: 0 }
const fetchReal = globalThis.fetch
globalThis.fetch = ((input: any, init?: any) => {
  const u = String(input?.url ?? input)
  if (u.startsWith('data:')) return fetchReal(input, init)
  if (u === `${URL_SB}/functions/v1/ofertare-ingest-doc`) {
    apeluri.edge++   // exact ce întorcea edge-ul omorât de memorie: fără câmpul `error`, fără `continua`
    return Promise.resolve(new Response(JSON.stringify({ code: 'WORKER_LIMIT', message: 'Memory limit exceeded' }), { status: 546 }))
  }
  if (u.startsWith('https://api.anthropic.com/')) { apeluri.anthropic++; return Promise.resolve(new Response(JSON.stringify({ error: { message: 'fără AI în test' } }), { status: 500 })) }
  return Promise.reject(new Error(`rețea interzisă în test: ${u}`))
}) as typeof fetch

// specificator calculat: ingest.ts nu intră în type-check-ul testului (are erori vechi de tipare supabase-js „never”,
// iar workerul rulează cu `deno run`, fără type-check) — se încarcă doar la rulare, după ce fetch-ul e interceptat
const { proceseazaIngest } = await import(new URL('./ingest.ts', import.meta.url).href)

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
      // PDF stricat, sub prag: pdfinfo pică → drumul vechi, edge-ul (simulat) „moare” fără error → rămâne 'neprocesat'
      { id: 900, licitatie_id: 101, fisier_path: '101/atribuire/900.pdf', nume_original: 'Anexa 3.pdf', tip: 'alta', status_procesare: 'neprocesat',
        eroare: null, size_bytes: 12, pagini_procesate: 0, pagina_offset: 0, analiza: null, text_extras: null },
      // alt 'ignorat' (spart în bucăți) → nu se atinge
      { id: 153, licitatie_id: 101, fisier_path: '101/atribuire/153.pdf', nume_original: 'B.1-SF DESEN.pdf', tip: 'alta', status_procesare: 'ignorat',
        eroare: '77 MB — prea mare pentru citirea AI; spart de platformă în 10 bucăți', size_bytes: 76926168, analiza: null, text_extras: null },
    ],
  }
  const supa: any = bd(tabele, { '101/atribuire/770.pdf': pdf770, '101/atribuire/900.pdf': new TextEncoder().encode('nu e un PDF!') })
  const t0 = Date.now()
  await proceseazaIngest(supa, 101, () => false, () => {})
  const d = (id: number) => tabele.ofertare_documente_atribuire.find(x => x.id === id)

  // (1) 770
  assertEquals(d(770).status_procesare, 'partial')
  assertEquals(d(770).pagini, 30); assertEquals(d(770).pagini_necitite, [5])
  assertMatch(d(770).text_extras, /^⟦PAGINA 1⟧\nStudiu geotehnic Huedin pagina 1/)
  assertEquals(d(770).analiza.citire_mare.stare, 'gata'); assertEquals(d(770).analiza.citire_mare.incercari, 1)
  assertEquals(d(770).procesat_de, 'u-razvan')
  // (2) 900: o singură trecere prin edge, apoi oprit cu motiv (înainte: buclă fără sfârșit)
  assertEquals(apeluri.edge, 1)
  assertEquals(d(900).status_procesare, 'eroare'); assertMatch(d(900).eroare, /revine în coadă după o trecere în aceeași tură/)
  // 153 neatins, coada închisă cu notă + notificare
  assertEquals(d(153).status_procesare, 'ignorat'); assertEquals(d(153).analiza, null)
  assertEquals(tabele.ofertare_ingest_coada[0].activ, false)
  assertMatch(tabele.ofertare_ingest_coada[0].nota, /1 parțiale, 1 cu eroare\/epuizate/)
  assertEquals(tabele.notifications.length, 1)
  assert(Date.now() - t0 < 30_000)

  // a doua activare a cozii: nimic de făcut pe 770 (sărit fără scriere), 900 rămâne eroare → încă o trecere, apoi stop
  tabele.ofertare_ingest_coada[0].activ = true
  const inainte = JSON.stringify(d(770))
  await proceseazaIngest(supa, 101, () => false, () => {})
  assertEquals(JSON.stringify(d(770)), inainte)
  assertEquals(tabele.ofertare_ingest_coada[0].activ, false)
} })
