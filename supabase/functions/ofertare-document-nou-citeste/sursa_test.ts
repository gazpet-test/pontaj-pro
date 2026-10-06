// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/sursa_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { alegeSursa, eTimeout, TEXT_MAX, TEXT_MIN, TIMEOUT_MS } from './sursa.ts'

Deno.test('document procesat cu text real → citește textul, nu PDF-ul', () => {
  const s = alegeSursa({ status_procesare: 'procesat', text_extras: 'x'.repeat(TEXT_MIN) })
  assertEquals(s.mod, 'text')
})

Deno.test('neprocesat / partial / eroare / text prea scurt / lipsă → PDF', () => {
  for (const r of [
    { status_procesare: 'neprocesat', text_extras: null },
    { status_procesare: 'partial', text_extras: 'y'.repeat(5000) },
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

Deno.test('eTimeout recunoaște abortul prin AbortSignal.timeout, nu și alte erori', async () => {
  let prins: unknown = null
  try { await fetch('http://127.0.0.1:9', { signal: AbortSignal.timeout(1) }) } catch (e) { prins = e }
  // pe unele platforme conexiunea refuzată câștigă cursa — atunci verificăm direct forma erorii
  if (prins && !eTimeout(prins)) prins = new DOMException('signal timed out', 'TimeoutError')
  assert(eTimeout(prins))
  assert(eTimeout(new DOMException('aborted', 'AbortError')))
  assert(!eTimeout(new TypeError('fetch failed')))
  assert(!eTimeout(null))
})
