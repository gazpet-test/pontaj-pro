// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/sursa_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { alegeSursa, amprentaText, BUGET_MS, eRezumatAi, eTimeout, MESAJ_TIMEOUT, MESAJ_TIMEOUT_TEXT, mesajTimeout, MIN_AI_MS, notaSursa, poateCitiPdf, provenanta, TEXT_MAX, TEXT_MIN, TIMEOUT_MS, timpRamas } from './sursa.ts'
import { scrieCitireNoi } from './scriere.ts'

Deno.test('document procesat cu text real → citește textul, nu PDF-ul', () => {
  const s = alegeSursa({ status_procesare: 'procesat', text_extras: 'x'.repeat(TEXT_MIN) })
  assertEquals(s.mod, 'text')
})

Deno.test('partial cu text real → citește textul (paginile lipsă sunt marcate NECITITĂ), cu nota partial', () => {
  const s = alegeSursa({ status_procesare: 'partial', text_extras: '⟦PAGINA 1⟧\n' + 'y'.repeat(5000) + '\n⟦PAGINA 2⟧\n[PAGINA 2: NECITITĂ]' })
  assert(s.mod === 'text' && s.partial === true)
  const p = alegeSursa({ status_procesare: 'procesat', text_extras: 'x'.repeat(TEXT_MIN) })
  assert(p.mod === 'text' && p.partial === false)
})

Deno.test('neprocesat / eroare / ignorat / text prea scurt / lipsă → PDF', () => {
  for (const r of [
    { status_procesare: 'neprocesat', text_extras: null },
    { status_procesare: 'ignorat', text_extras: 'y'.repeat(5000) },
    { status_procesare: 'eroare', text_extras: 'z'.repeat(5000) },
    { status_procesare: 'procesat', text_extras: '   antet  ' },
    { status_procesare: 'procesat', text_extras: 'w'.repeat(TEXT_MIN - 1) },
    {},
  ]) assertEquals(alegeSursa(r).mod, 'pdf', JSON.stringify(r).slice(0, 80))
})

Deno.test('textul trimis e plafonat la TEXT_MAX', () => {
  const s = alegeSursa({ status_procesare: 'procesat', text_extras: 'a'.repeat(TEXT_MAX + 10) })
  assert(s.mod === 'text' && s.text.length === TEXT_MAX)
})

Deno.test('timeout-ul apelului AI lasă loc față de limita de 150 s a gateway-ului', () => {
  assert(TIMEOUT_MS <= 135_000 && TIMEOUT_MS >= 129_000)   // ≥ cea mai lungă citire reușită (129 s, 05.10), < 150 s gateway
})

// Abort REAL (review ultracode 06.10, P3: testul vechi înlocuia eroarea cu una făcută de mână): un server local care nu răspunde
// deloc (/antet) și unul care trimite antetul, apoi tace la corp (/corp, ca un resp.json() blocat) — AbortSignal.timeout taie ambele.
Deno.test({ name: 'eTimeout recunoaște abortul real al fetch-ului ȘI al citirii corpului; nu și alte erori', sanitizeOps: false, sanitizeResources: false, async fn() {
  const ac = new AbortController()
  const srv = Deno.serve({ port: 0, hostname: '127.0.0.1', signal: ac.signal, onListen() {} }, (req) =>
    new URL(req.url).pathname === '/corp'
      ? new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"a":')) } }), { headers: { 'content-type': 'application/json' } })
      : new Promise<Response>(() => {}))
  const port = (srv.addr as Deno.NetAddr).port
  try {
    for (const cale of ['/antet', '/corp']) {
      let prins: unknown = null
      try { const r = await fetch(`http://127.0.0.1:${port}${cale}`, { signal: AbortSignal.timeout(200) }); await r.json() } catch (e) { prins = e }
      assert(eTimeout(prins), `${cale}: ${String(prins)}`)
    }
  } finally { ac.abort() }
  assert(eTimeout(new DOMException('aborted', 'AbortError')))
  assert(!eTimeout(new TypeError('fetch failed')))
  assert(!eTimeout(null))
}})

Deno.test('termenul AI se socotește de la intrarea în handler (Copilot P2): pregătirea lungă scurtează apelul, nu îl împinge peste 150 s', () => {
  assertEquals(timpRamas(0, 0), TIMEOUT_MS)                       // pornire imediată → plafonul întreg
  assertEquals(timpRamas(0, 25_000), BUGET_MS - 25_000)           // 25 s de descărcare/base64 → AI-ul primește doar restul
  assert(BUGET_MS < 150_000 - 5_000)                              // rămâne loc de scriere + răspuns sub gateway
  for (const scurs of [0, 5_000, 10_000, 40_000, 100_000, 124_000]) {
    const r = timpRamas(0, scurs)
    assert(r === 0 || scurs + r <= BUGET_MS, `scurs ${scurs}`)
  }
  assertEquals(timpRamas(0, BUGET_MS - MIN_AI_MS + 1), 0)         // prea puțin timp → nu mai pornește apelul plătit
  assertEquals(timpRamas(1_000, 1_000 + BUGET_MS - MIN_AI_MS), MIN_AI_MS)
})

// Format real scris de scrieCitireNoi (nu o copie a lui): un rând simulat „neprocesat” primește rezumatul ca text_extras.
function dbUnRand(rand: any) {
  const b: any = { select: () => b, eq: () => b, is: () => b, update: (p: any) => { b._p = p; return b },
    maybeSingle: () => Promise.resolve({ data: structuredClone(rand), error: null }),
    then: (ok: any, ko: any) => Promise.resolve().then(() => { if (b._p) Object.assign(rand, b._p); return { data: [{ id: rand.id }], error: null } }).then(ok, ko) }
  return { from: () => b }
}
Deno.test('rezumatul AI scris în text_extras NU e luat drept textul documentului (recitește ar rezuma rezumatul) → PDF', async () => {
  const rand: any = { id: 7, status_procesare: 'neprocesat', text_extras: null, analiza: null }
  const citire = { tip: 'raspuns_clarificare', rezumat: 'R'.repeat(800), modificari: [{ ce_se_schimba: 'a' }], intrebari_raspunse: [{ intrebare_scurt: 'q', raspuns_scurt: 'r' }] }
  await scrieCitireNoi(dbUnRand(rand), 7, citire, 'Raspuns consolidat nr. 2.pdf')
  assertEquals(rand.status_procesare, 'procesat')
  assert(String(rand.text_extras).length >= TEXT_MIN && eRezumatAi(String(rand.text_extras).trim()))
  assertEquals(alegeSursa(rand).mod, 'pdf')
  assert(!eRezumatAi('⟦PAGINA 1⟧\nDOCUMENT: x\nTip: y'))   // un text real care conține aceleași cuvinte, dar nu la început
})

Deno.test('poarta PDF pe server: owner / responsabil / intern da; coleg cu acces Ofertare nu', () => {
  assert(poateCitiPdf({ intern: true }))
  assert(poateCitiPdf({ intern: false, isOwner: true, uid: 'u1' }))
  assert(poateCitiPdf({ intern: false, isOwner: false, responsabilId: 'u1', uid: 'u1' }))
  assert(!poateCitiPdf({ intern: false, isOwner: false, responsabilId: 'u2', uid: 'u1' }))
  assert(!poateCitiPdf({ intern: false, isOwner: null, responsabilId: null, uid: 'u1' }))
  assert(!poateCitiPdf({ intern: false, responsabilId: null, uid: null }))
})

Deno.test('mesajul de timp depășit depinde de sursă: pe text nu trimite la «Procesează»', () => {
  assertEquals(mesajTimeout('pdf'), MESAJ_TIMEOUT)
  assertEquals(mesajTimeout('text'), MESAJ_TIMEOUT_TEXT)
  assert(!MESAJ_TIMEOUT_TEXT.includes('Procesează'))
})

// Copilot conv. 3 (06.10, P1): o clarificare aflată DUPĂ TEXT_MAX nu poate dispărea într-o citire declarată completă.
Deno.test('text peste TEXT_MAX: clarificarea de după plafon nu e trimisă, dar citirea e declarată PARȚIALĂ, iar AI-ul e anunțat', async () => {
  const tarzie = 'CLARIFICARE-TARZIE: termenul de depunere se mută la 2026-11-30'
  const text = '⟦PAGINA 1⟧\n' + 'a'.repeat(TEXT_MAX) + '\n⟦PAGINA 900⟧\n' + tarzie
  const s = alegeSursa({ status_procesare: 'procesat', text_extras: text })
  assert(s.mod === 'text')
  assert(!s.text.includes(tarzie))                                  // textul trimis nu o conține…
  assert(s.trunchiat && s.lungimeSursa === text.length)
  const p = provenanta(s, await amprentaText(text))
  assertEquals(p.sursa_completa, false)                             // …deci rezultatul NU e declarat complet
  assertEquals(p.motive_incomplet, ['trunchiat'])
  assertEquals([p.lungime_sursa, p.lungime_folosita], [text.length, TEXT_MAX])
  assert(/^[0-9a-f]{64}$/.test(String(p.sursa_sha256)))
  assert(notaSursa(s).includes(`primele ${TEXT_MAX} din ${text.length}`))
})

Deno.test('proveniența: text complet = completă; partial = pagini_necitite; PDF = sursa pdf', async () => {
  const c = alegeSursa({ status_procesare: 'procesat', text_extras: 'x'.repeat(TEXT_MIN) })
  const pc = provenanta(c, 'h')
  assertEquals([pc.sursa, pc.sursa_completa, pc.motive_incomplet.length, pc.lungime_folosita], ['text', true, 0, TEXT_MIN])
  assertEquals(notaSursa(c), '')
  const pp = provenanta(alegeSursa({ status_procesare: 'partial', text_extras: 'y'.repeat(TEXT_MIN) }), 'h')
  assertEquals([pp.sursa_completa, pp.motive_incomplet], [false, ['pagini_necitite']])
  assertEquals(provenanta({ mod: 'pdf' }, null).sursa, 'pdf')
  assertEquals(await amprentaText('  abc \n'), await amprentaText('abc'))
})
