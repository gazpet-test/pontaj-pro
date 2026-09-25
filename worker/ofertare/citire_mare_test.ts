// deno test --node-modules-dir=none --allow-read --allow-write --allow-run=pdftotext,pdfinfo worker/ofertare/citire_mare_test.ts
// R6 / doc 770: eligibilitatea PDF-urilor mari, fragmentarea pe felii, compunerea textului, anti-buclă, citirea cap-coadă
// pe o BD simulată (fără rețea, fără Supabase, fără AI). Testul cu pdftotext real se sare dacă poppler lipsește.
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1'
import {
  CALE_REV_MARE, MARCAJ_PREA_MARE, MAX_INCERCARI_MARE, MAX_MARE_BYTES, PRAG_MARE, citesteMare, compuneText, decizieCitireMare,
  descarcaPeDisc, esteMare, extragePeFelii, extractorPdftotext, imparteText, mesajNecitite, paginiPdf, trecereBlocata, type Extractor,
} from './citire_mare.ts'

// rândul real al doc 770 (SELECT 25.09 seara, lic. 101)
const DOC_770 = {
  id: 770, licitatie_id: 101, fisier_path: '101/atribuire/mufhldi9_Documentatie_tehnica_HUEDIN_Lot_1_Studiu_geotehnic__Transgaz_Anexe.pdf',
  nume_original: 'Documentatie tehnica HUEDIN Lot 1/Studiu geotehnic__Transgaz+Anexe.pdf', tip: 'alta', status_procesare: 'ignorat',
  eroare: 'prea mare pentru citirea automată (95 MB > 60 MB) — de spart pe bucăți / procesat pe NAS', size_bytes: 99948369,
  pagini: null, pagini_procesate: 0, pagina_offset: 0, revizie: null, analiza: null,
}

// ---------------- eligibilitate ----------------
Deno.test('770 așa cum e în BD (ignorat de edge pe mărime) → eligibil, încercarea 1', () => {
  assert(esteMare(DOC_770))
  assertEquals(decizieCitireMare(DOC_770), { actiune: 'citeste', incercare: 1 })
  assert(DOC_770.eroare.startsWith(MARCAJ_PREA_MARE), 'marcajul trebuie să fie exact textul scris de edge (PR #478)')
})

Deno.test('ignorat din ALT motiv (spart în bucăți / planșe) → nu se atinge', () => {
  const spart = { status_procesare: 'ignorat', size_bytes: 76926168, eroare: '77 MB — prea mare pentru citirea AI; spart de platformă în 10 bucăți (doc 180–189), rămâne' }
  assertEquals(decizieCitireMare(spart).actiune, 'sari')
  const nonPdf = { status_procesare: 'ignorat', size_bytes: 500, eroare: 'doar PDF se proceseaza in M1' }
  assert(!esteMare(nonPdf))
})

Deno.test('sub 60 MB → drumul obișnuit; peste 60 MB neprocesat → pe felii (fără să mai treacă prin edge)', () => {
  assertEquals(decizieCitireMare({ status_procesare: 'neprocesat', size_bytes: PRAG_MARE }).actiune, 'sari')
  assertEquals(decizieCitireMare({ status_procesare: 'neprocesat', size_bytes: PRAG_MARE + 1 }), { actiune: 'citeste', incercare: 1 })
  assertEquals(decizieCitireMare({ status_procesare: 'neprocesat', size_bytes: null }).actiune, 'sari')
})

Deno.test('deja procesat / parțial → sărit', () => {
  for (const st of ['procesat', 'partial']) assertEquals(decizieCitireMare({ ...DOC_770, status_procesare: st }).actiune, 'sari')
})

Deno.test('încercări: in_curs (procesul a murit) se numără; la plafon → refuz; după refuz → sărit (nu mai scrie nimic)', () => {
  const cu = (stare: string, incercari: number, status = 'in_lucru') => ({ ...DOC_770, status_procesare: status, eroare: null, citire_mare: { stare, incercari } })
  assertEquals(decizieCitireMare(cu('in_curs', 1)), { actiune: 'citeste', incercare: 2 })
  assertEquals(decizieCitireMare(cu('eroare', 2, 'eroare')), { actiune: 'citeste', incercare: 3 })
  const r = decizieCitireMare(cu('in_curs', MAX_INCERCARI_MARE))
  assertEquals(r.actiune, 'refuza'); assertMatch((r as any).motiv, /procesul s-a oprit/)
  assertEquals(decizieCitireMare(cu('esuat', MAX_INCERCARI_MARE, 'eroare')).actiune, 'sari')
  // după eșecul definitiv edge-ul poate rescrie 'ignorat' + marcajul lui (Procesare din UI) — tot sărit
  assertEquals(decizieCitireMare({ ...DOC_770, citire_mare: { stare: 'esuat', incercari: 3 } }).actiune, 'sari')
})

Deno.test('o citire începută ține documentul pe drumul mare chiar dacă size_bytes lipsește', () => {
  const d = { status_procesare: 'eroare', size_bytes: null, eroare: 'citire NAS …', analiza: { citire_mare: { stare: 'eroare', incercari: 1 } } }
  assert(esteMare(d)); assertEquals(decizieCitireMare(d), { actiune: 'citeste', incercare: 2 })
})

Deno.test('peste plafonul de mărime → refuz cu motiv; reset manual după „gata” → de la încercarea 1', () => {
  const r = decizieCitireMare({ status_procesare: 'neprocesat', size_bytes: MAX_MARE_BYTES + 1 })
  assertEquals(r.actiune, 'refuza'); assertMatch((r as any).motiv, /plafonul/)
  assertEquals(decizieCitireMare({ ...DOC_770, status_procesare: 'neprocesat', citire_mare: { stare: 'gata', incercari: 2 } }), { actiune: 'citeste', incercare: 1 })
})

Deno.test('trecereBlocata: document normal — a doua trecere în aceeași tură = buclă; PDF mare — plafonul + trecerea de refuz', () => {
  assert(!trecereBlocata(1, false)); assert(trecereBlocata(2, false))
  assert(!trecereBlocata(MAX_INCERCARI_MARE + 1, true)); assert(trecereBlocata(MAX_INCERCARI_MARE + 2, true))
})

// ---------------- fragmentare ----------------
const extractorFals = (nPag: number, rele: Set<number> = new Set(), text = (p: number) => `Pagina ${p} — foraj F${p}, argilă nisipoasă, nivel hidrostatic ${p} m`) => {
  const apeluri: Array<[number, number]> = []
  const f: Extractor = async (de, la) => {
    apeluri.push([de, la])
    if (la > nPag) return { ok: false, motiv: 'interval în afara documentului' }
    for (let p = de; p <= la; p++) if (rele.has(p)) return { ok: false, motiv: `pagina ${p} coruptă` }
    return { ok: true, pagini: Array.from({ length: la - de + 1 }, (_, i) => text(de + i)) }
  }
  return { f, apeluri }
}

Deno.test('felii fără erori: 95 pagini / felie 25 → 1-25, 26-50, 51-75, 76-95', async () => {
  const { f, apeluri } = extractorFals(95)
  const r = await extragePeFelii(95, f, { felie: 25 })
  assertEquals(apeluri, [[1, 25], [26, 50], [51, 75], [76, 95]])
  assertEquals(r.pagini.length, 95); assertEquals(r.oprit, null)
  assertEquals(r.pagini[94], 'Pagina 95 — foraj F95, argilă nisipoasă, nivel hidrostatic 95 m')
})

Deno.test('o pagină care pică: felia se înjumătățește până la ea, doar ea rămâne necitită, restul se citește', async () => {
  const { f, apeluri } = extractorFals(60, new Set([20]))
  const r = await extragePeFelii(60, f, { felie: 25 })
  assertEquals(r.pagini.length, 60)
  assertEquals(r.pagini[19], { eroare: 'pagina 20 coruptă' })
  assertEquals(r.pagini.filter(p => typeof p !== 'string').length, 1)
  assert(apeluri.some(([de, la]) => de === 20 && la === 20), 'ajunge la felia de o pagină')
  assert(apeluri.length < 25, `fără explozie de apeluri (${apeluri.length})`)
})

Deno.test('extractorul întoarce mai puține/mai multe pagini decât intervalul → normalizat la exact n', async () => {
  const f: Extractor = async (de, la) => ({ ok: true, pagini: de === 1 ? ['a'.repeat(30)] : Array(la - de + 5).fill('b'.repeat(30)) })
  const r = await extragePeFelii(10, f, { felie: 5 })
  assertEquals(r.pagini.length, 10); assertEquals(r.pagini[1], '')
})

Deno.test('bugetul de caractere oprește extragerea (restul nu mai încape oricum); oprirea și termenul la fel', async () => {
  const { f, apeluri } = extractorFals(1000, new Set(), () => 'x'.repeat(5000))
  const r = await extragePeFelii(1000, f, { felie: 25, buget: 100_000 })
  assertEquals(r.oprit, 'buget'); assert(r.pagini.length < 100 && r.pagini.length >= 20); assert(apeluri.length <= 4)
  let n = 0
  const r2 = await extragePeFelii(1000, f, { felie: 25, oprire: () => ++n > 2 })
  assertEquals(r2.oprit, 'oprire'); assertEquals(r2.pagini.length, 50)
  let t = 0
  const r3 = await extragePeFelii(1000, f, { felie: 25, termenMs: 2, acum: () => t++ })
  assertEquals(r3.oprit, 'timp')
})

// ---------------- compunerea textului ----------------
Deno.test('imparteText: pdftotext separă paginile cu \\f; normalizare ca în textLocal', () => {
  assertEquals(imparteText('A  \t  b   \nc\f\fD\f', 3), ['A  b\nc', '', 'D'])
  assertEquals(imparteText('A\f', 3), ['A', '', ''])
  assertEquals(imparteText('A\fB\fC\f', 2), ['A', 'B'])
})

Deno.test('compuneText: marcaje cu pagina_offset, pagini fără text și cu eroare → necitite, mesaj compatibil', () => {
  const lung = 'text util de geotehnică, suficient de lung'
  const c = compuneText([lung, '   ', { eroare: 'pdftotext cod 1: x' }, lung], 4, 48)
  assertMatch(c.text, /^⟦PAGINA 49⟧\ntext util/)
  assertMatch(c.text, /⟦PAGINA 50⟧\n\[PAGINA 50: fără text în stratul PDF/)
  assertMatch(c.text, /⟦PAGINA 51⟧\n\[PAGINA 51: NECITITĂ — pdftotext cod 1: x\]/)
  assertEquals(c.necitite, [50, 51])
  assertEquals(mesajNecitite(c), '1 pagină fără text (imagini): 50; 1 pagină pe care pdftotext a eșuat: 51')
  // cazul obișnuit: exact formatul de până acum din ingest.ts
  const d = compuneText([lung, '', ''], 3)
  assertEquals(mesajNecitite(d), '2 pagini fără text (imagini): 2, 3')
  assertEquals(mesajNecitite(compuneText([lung], 1)), null)
})

Deno.test('compuneText: plafonul pe pagini — paginile care nu încap (sau neextrase) intră în pagini_necitite, cu notă', () => {
  const p = 'y'.repeat(400)
  const c = compuneText([p, p, p, p], 6, 0, 1200)
  assert(c.text.length <= 1200, `textul respectă plafonul (${c.text.length})`)
  assertEquals(c.netrecute, [3, 4, 5, 6]); assertEquals(c.necitite, [3, 4, 5, 6])
  assertMatch(c.text, /\[TRUNCHIAT la 1k caractere — paginile 3-6 necitite\]$/)
  assertMatch(mesajNecitite(c)!, /paginile 3-6 necitite/)
})

// ---------------- descărcarea în flux ----------------
Deno.test('descarcaPeDisc: scrie pe disc, SHA-256 din mers; peste plafon → eroare', async () => {
  const dir = await Deno.makeTempDir()
  try {
    const url = 'data:application/pdf;base64,' + btoa('abc')
    const r = await descarcaPeDisc(url, `${dir}/a.pdf`, 10)
    assertEquals(r, { marime: 3, sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' })
    assertEquals(new TextDecoder().decode(await Deno.readFile(`${dir}/a.pdf`)), 'abc')
    await assertRejects(() => descarcaPeDisc('data:application/pdf;base64,' + btoa('x'.repeat(100)), `${dir}/b.pdf`, 50), Error, 'peste plafonul')
  } finally { await Deno.remove(dir, { recursive: true }) }
})

// ---------------- cap-coadă pe BD simulată ----------------
const cale = (row: any, c: string) => {
  let v = row
  for (const p of c.split(/->>?/)) v = v == null ? undefined : v[p]
  return c.includes('->>') ? (v == null ? null : String(v)) : v
}
function bdFalsa(docs: any[], opt: { signedUrl?: (path: string) => string | null; manifest?: any[] } = {}) {
  const tabele: Record<string, any[]> = { ofertare_documente_atribuire: docs, ai_usage_log: [], ofertare_seap_manifest: opt.manifest ?? [] }
  const n = { scrieri: 0, conflicte: 0 }
  const from = (t: string) => {
    tabele[t] ||= []
    const filtre: ((r: any) => boolean)[] = []
    let op: { tip: 'sel' | 'upd' | 'ins'; patch?: any } = { tip: 'sel' }
    const pot = () => tabele[t].filter(r => filtre.every(f => f(r)))
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: unknown) => { filtre.push(r => String(cale(r, c)) === String(v)); return b },
      is: (c: string, v: unknown) => { filtre.push(r => (cale(r, c) ?? null) === v); return b },
      update: (p: any) => { op = { tip: 'upd', patch: p }; return b },
      insert: (p: any) => { op = { tip: 'ins', patch: p }; return b },
      maybeSingle: () => Promise.resolve({ data: structuredClone(pot()[0] ?? null), error: null }),
      then: (ok: any, ko: any) => Promise.resolve((() => {
        if (op.tip === 'ins') { tabele[t].push(structuredClone(op.patch)); return { data: null, error: null } }
        const rows = pot()
        if (op.tip === 'upd') { for (const r of rows) Object.assign(r, structuredClone(op.patch)); if (rows.length) n.scrieri++; else n.conflicte++ }
        return { data: structuredClone(rows), error: null }
      })()).then(ok, ko),
    }
    return b
  }
  const storage = { from: () => ({ createSignedUrl: (p: string) => {
    const u = opt.signedUrl?.(p) ?? null
    return Promise.resolve(u ? { data: { signedUrl: u }, error: null } : { data: null, error: { message: 'Object not found' } })
  } }) }
  return { supa: { from, storage }, tabele, n }
}
const dataUrl = (b: Uint8Array) => 'data:application/pdf;base64,' + btoa(String.fromCharCode(...b))
const doc = (bd: any, id = 770) => bd.tabele.ofertare_documente_atribuire.find((d: any) => d.id === id)

Deno.test('cap-coadă (extractor simulat): 770 citit pe felii → aceleași coloane ca ingest.ts + urma în analiza.citire_mare', async () => {
  const octeti = new TextEncoder().encode('%PDF-1.4 simulat')
  const { f } = extractorFals(60, new Set([7]), (p) => `Pagina ${p} — foraj F${p}, argilă nisipoasă cafenie, nivel hidrostatic ${p} m; umiditate naturală 18%, indice de consistență 0,75`)
  const sha = 'b003d34016a07e89bce714cc19a400d1aa1604f859eded6f62a28dba2d72d43d'   // din manifest (alt conținut aici → „diferit”)
  const bd = bdFalsa([{ ...DOC_770, size_bytes: octeti.length }], { signedUrl: () => dataUrl(octeti), manifest: [{ document_id: 770, sha256: sha, verificat_la: '2026-09-25T17:33:08Z' }] })
  const antete: string[] = []
  const rez = await citesteMare(bd.supa, 770, {
    cerutDe: 'u1', dirLucru: await Deno.makeTempDir(), felie: 25, pagini: async () => ({ nPag: 60 }), extractor: () => f,
    antet: async (t) => { antete.push(t); return { antet: { obiectiv: 'Huedin', revizie: 'Rev. 1' }, tokIn: 100, tokOut: 20 } },
    modelAntet: { id: 'haiku-test', in: 1e-6, out: 5e-6 },
  })
  assertMatch(rez, /^partial \(60 pagini/)
  const d = doc(bd)
  assertEquals(d.status_procesare, 'partial'); assertEquals(d.pagini, 60); assertEquals(d.pagini_procesate, 60)
  assertEquals(d.pagini_necitite, [7]); assertEquals(d.size_bytes, octeti.length); assertEquals(d.ocr, false); assertEquals(d.procesat_de, 'u1')
  assertMatch(d.eroare, /citit pe NAS pe felii .* 1 pagină pe care pdftotext a eșuat: 7/)
  assertMatch(d.text_extras, /^⟦PAGINA 1⟧\nPagina 1 — foraj/); assertMatch(d.text_extras, /⟦PAGINA 60⟧\nPagina 60/)
  assertEquals(d.antet.obiectiv, 'Huedin'); assertEquals(d.revizie, 'Rev. 1')
  assertEquals(antete.length, 1); assertEquals(bd.tabele.ai_usage_log.length, 1)
  const cm = d.analiza.citire_mare
  assertEquals(cm.stare, 'gata'); assertEquals(cm.incercari, 1); assertEquals(cm.pagini_cu_text, 59); assertEquals(cm.pagini_eroare, [7])
  assertEquals(cm.inainte.status, 'ignorat'); assertEquals(cm.manifest.identic, false); assertEquals(cm.manifest.sha256, sha)
  // a doua trecere: sărit, fără nicio scriere (nu poate bucla) — și cu mărimea reală a lui 770 în BD
  const scrieri = bd.n.scrieri
  assertMatch(await citesteMare(bd.supa, 770, { cerutDe: 'u1' }), /^sărit:/)
  assertEquals(decizieCitireMare({ ...d, size_bytes: 99948369 }), { actiune: 'sari', motiv: 'deja partial' })
  assertEquals(bd.n.scrieri, scrieri)
})

Deno.test('anti-buclă: procesul moare de 3 ori în timpul citirii → încercări numărate în BD → refuz definitiv → sărit', async () => {
  const octeti = new TextEncoder().encode('%PDF')
  const bd = bdFalsa([{ ...DOC_770, size_bytes: octeti.length }], { signedUrl: () => dataUrl(octeti) })
  const dir = await Deno.makeTempDir()
  const moare = { cerutDe: null, dirLucru: dir, pagini: () => { throw new Error('Memory limit exceeded (simulat)') } }
  for (let i = 1; i <= MAX_INCERCARI_MARE; i++) {
    await assertRejects(() => citesteMare(bd.supa, 770, moare as any))
    assertEquals(doc(bd).analiza.citire_mare.stare, 'in_curs'); assertEquals(doc(bd).analiza.citire_mare.incercari, i)
    assertEquals(doc(bd).status_procesare, 'in_lucru')
  }
  const r = await citesteMare(bd.supa, 770, moare as any)
  assertMatch(r, /^eroare: refuzat — 3 încercări fără rezultat/)
  assertEquals(doc(bd).status_procesare, 'eroare'); assertEquals(doc(bd).analiza.citire_mare.stare, 'esuat')
  assertMatch(doc(bd).eroare, /oprită definitiv: 3 încercări/)
  const scrieri = bd.n.scrieri
  for (let i = 0; i < 5; i++) assertMatch(await citesteMare(bd.supa, 770, moare as any), /^sărit: oprit definitiv/)
  assertEquals(bd.n.scrieri, scrieri, 'după refuz nu se mai scrie nimic')
})

Deno.test('eroare trecătoare (descărcare) → „reia” cu încercarea numărată; a 3-a → eșec definitiv cu motiv în BD', async () => {
  const bd = bdFalsa([{ ...DOC_770 }], { signedUrl: () => null })
  const deps = { cerutDe: null, dirLucru: await Deno.makeTempDir() }
  assertMatch(await citesteMare(bd.supa, 770, deps), /^reia: URL semnat din Storage: Object not found/)
  assertEquals(doc(bd).status_procesare, 'eroare'); assertMatch(doc(bd).eroare, /încercarea 1\/3: .* — se reia/)
  assertMatch(await citesteMare(bd.supa, 770, deps), /^reia:/)
  assertMatch(await citesteMare(bd.supa, 770, deps), /^eroare: URL semnat/)
  assertEquals(doc(bd).analiza.citire_mare.stare, 'esuat'); assertMatch(doc(bd).eroare, /încercarea 3\/3: .* oprită definitiv/)
  assertMatch(await citesteMare(bd.supa, 770, deps), /^sărit/)
})

Deno.test('mărime diferită de BD (descărcare incompletă) și scan întreg → eșec explicit, nu „citit”', async () => {
  const octeti = new TextEncoder().encode('%PDF-1.4 x')
  const bd = bdFalsa([{ ...DOC_770, size_bytes: 99948369 }], { signedUrl: () => dataUrl(octeti) })
  assertMatch(await citesteMare(bd.supa, 770, { cerutDe: null, dirLucru: await Deno.makeTempDir() }), /^reia: descărcați 10 B, în BD 99948369 B/)
  const bd2 = bdFalsa([{ ...DOC_770, size_bytes: octeti.length }], { signedUrl: () => dataUrl(octeti) })
  const { f } = extractorFals(40, new Set(), () => '')
  const r = await citesteMare(bd2.supa, 770, { cerutDe: null, dirLucru: await Deno.makeTempDir(), pagini: async () => ({ nPag: 40 }), extractor: () => f })
  assertMatch(r, /^eroare: niciuna din cele 40 pagini nu are strat de text/)
  assertEquals(doc(bd2).analiza.citire_mare.stare, 'esuat'); assertEquals(doc(bd2).status_procesare, 'eroare')
})

Deno.test('oprirea workerului (SIGTERM) nu consumă încercarea: documentul revine la starea dinainte (ignorat + motivul edge)', async () => {
  const octeti = new TextEncoder().encode('%PDF')
  const bd = bdFalsa([{ ...DOC_770, size_bytes: octeti.length }], { signedUrl: () => dataUrl(octeti) })
  let k = 0
  const { f } = extractorFals(100)
  const r = await citesteMare(bd.supa, 770, { cerutDe: null, dirLucru: await Deno.makeTempDir(), pagini: async () => ({ nPag: 100 }), extractor: () => f, felie: 10, esteOprire: () => ++k > 3 })
  assertMatch(r, /^întrerupt/)
  assertEquals(doc(bd).status_procesare, 'ignorat'); assert(doc(bd).eroare.startsWith(MARCAJ_PREA_MARE))
  assertEquals(decizieCitireMare(doc(bd)), { actiune: 'citeste', incercare: 1 })
})

Deno.test('CAS: dacă altcineva a scris citire_mare între timp, rezultatul nu suprascrie', async () => {
  const octeti = new TextEncoder().encode('%PDF')
  const bd = bdFalsa([{ ...DOC_770, size_bytes: octeti.length }], { signedUrl: () => dataUrl(octeti) })
  const { f } = extractorFals(5)
  const r = await citesteMare(bd.supa, 770, {
    cerutDe: null, dirLucru: await Deno.makeTempDir(), extractor: () => f,
    pagini: async () => { doc(bd).analiza.citire_mare.rev = 'alt-worker'; return { nPag: 5 } },
  })
  assertMatch(r, /^eroare: rezultatul nu s-a putut scrie/)
  assertEquals(doc(bd).text_extras, undefined); assertEquals(CALE_REV_MARE, 'analiza->citire_mare->>rev')
})

// ---------------- pdftotext real (poppler) ----------------
const arePoppler = await (async () => { try { return (await new Deno.Command('pdftotext', { args: ['-v'], stderr: 'null', stdout: 'null' }).output()).success } catch { return false } })()

// PDF minimal valid (ASCII → offseturile xref = lungimea șirului), o pagină per text; '' = pagină goală
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

Deno.test({ name: 'pdftotext real: -f/-l pe felii de 2 pagini, pagina goală → necitită, marcaje corecte', ignore: !arePoppler, fn: async () => {
  const texte = Array.from({ length: 7 }, (_, i) => i === 2 ? '' : `Pagina ${i + 1} studiu geotehnic foraj F${i + 1} strat argila nisipoasa nivel hidrostatic`)
  const pdf = pdfMinimal(texte)
  const dir = await Deno.makeTempDir()
  try {
    await Deno.writeFile(`${dir}/t.pdf`, pdf)
    assertEquals(await paginiPdf(`${dir}/t.pdf`), { nPag: 7 })
    const r = await extractorPdftotext(`${dir}/t.pdf`)(2, 4)
    assert(r.ok); assertEquals((r as any).pagini.length, 3); assertEquals((r as any).pagini[1], '')
    assert(!(await extractorPdftotext(`${dir}/t.pdf`)(9, 12)).ok, 'interval în afara documentului → eroare, nu text gol')
    assertMatch(String((await paginiPdf(`${dir}/lipsa.pdf`) as any).motiv), /pdfinfo/)
    const bd = bdFalsa([{ ...DOC_770, size_bytes: pdf.length, pagina_offset: 10 }], { signedUrl: () => dataUrl(pdf) })
    const rez = await citesteMare(bd.supa, 770, { cerutDe: null, dirLucru: dir, felie: 2 })
    assertMatch(rez, /^partial \(7 pagini/)
    const d = doc(bd)
    assertEquals(d.pagini_necitite, [13]); assertEquals(d.analiza.citire_mare.felii, 4)
    assertMatch(d.text_extras, /^⟦PAGINA 11⟧\nPagina 1 studiu geotehnic/); assertMatch(d.text_extras, /⟦PAGINA 17⟧\nPagina 7 studiu/)
    assertEquals(d.analiza.citire_mare.sha256.length, 64)
    assert(!(await Deno.stat(`${dir}/ingest_mare_770.pdf`).catch(() => null)), 'fișierul temporar e șters')
  } finally { await Deno.remove(dir, { recursive: true }) }
} })
