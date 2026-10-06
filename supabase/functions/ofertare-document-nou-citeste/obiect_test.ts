// deno test --node-modules-dir=none --no-lock -A supabase/functions/ofertare-document-nou-citeste/obiect_test.ts
// Copilot conv. 3 (06.10, P1): identitatea obiectului citit pe calea PDF — bytes-ii citiți de AI sunt legați de un obiect anume.
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { aceeasiIdentitate, identitateObiect, shaOcteti } from './obiect.ts'
import { provenanta } from './sursa.ts'

const supa = (fisiere: any[], eroare: unknown = null) => ({ storage: { from: (_b: string) => ({
  list: (dir: string, o: any) => Promise.resolve({ data: eroare ? null : fisiere.filter((f) => f.dir === dir && f.name.includes(o.search)), error: eroare }),
}) } })
const OB = { dir: '103/atribuire', name: 'Raspuns consolidat nr. 2.pdf', id: 'u1', updated_at: '2026-10-06T10:00:00Z', metadata: { eTag: '"e1"', size: 2700000 } }

Deno.test('identitateObiect: potrivire EXACTĂ pe nume (căutarea e pe fragment), câmpurile id / updated_at / eTag / mărime', async () => {
  const alt = { ...OB, name: 'Raspuns consolidat nr. 2.pdf.bak', id: 'u9' }
  const i = await identitateObiect(supa([alt, OB]), 'ofertare', '103/atribuire/Raspuns consolidat nr. 2.pdf')
  assertEquals(i, { id: 'u1', updated_at: '2026-10-06T10:00:00Z', etag: '"e1"', size: 2700000 })
  assertEquals(await identitateObiect(supa([OB]), 'ofertare', '103/atribuire/lipsa.pdf'), null)
  assertEquals(await identitateObiect(supa([OB], { message: 'x' }), 'ofertare', '103/atribuire/Raspuns consolidat nr. 2.pdf'), null)
})

Deno.test('aceeasiIdentitate: rescriere la aceeași cale (alt eTag / updated_at / id / mărime) ≠ același obiect; lipsă = fail-closed', () => {
  const a = { id: 'u1', updated_at: 'T1', etag: '"e1"', size: 10 }
  assert(aceeasiIdentitate(a, { ...a }))
  for (const b of [{ ...a, etag: '"e2"' }, { ...a, updated_at: 'T2' }, { ...a, id: 'u2' }, { ...a, size: 11 }]) assert(!aceeasiIdentitate(a, b))
  assert(!aceeasiIdentitate(a, null) && !aceeasiIdentitate(null, a))
  assert(!aceeasiIdentitate({ id: null, updated_at: null, etag: null, size: null }, { id: null, updated_at: null, etag: null, size: null }))
})

Deno.test('proveniența PDF: SHA-256 pe bytes-ii citiți + identitatea obiectului', async () => {
  const sha = await shaOcteti(new TextEncoder().encode('%PDF-1.7 test'))
  assert(/^[0-9a-f]{64}$/.test(sha))
  assert(sha !== await shaOcteti(new TextEncoder().encode('%PDF-1.7 altul')))
  const ob = { id: 'u1', updated_at: 'T1', etag: '"e1"', size: 13 }
  const p = provenanta({ mod: 'pdf' }, sha, ob)
  assertEquals([p.sursa, p.sursa_sha256, p.sursa_obiect], ['pdf', sha, ob])
})
