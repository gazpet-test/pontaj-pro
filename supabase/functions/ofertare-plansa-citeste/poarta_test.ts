// deno test --allow-env supabase/functions/ofertare-plansa-citeste/poarta_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, fakeFetch, fakeSupa, getUser, LICITATII, OWNER, PROFILE, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'
import { poateCheltui } from './poarta.ts'

Deno.env.set('POARTA_TEST', '1')
const { handler } = await import('./index.ts')

// doc 470 (lic 95) are felii în storage (listă goală în fake => 404 „nicio felie", DUPĂ poartă)
const DOCS = [{ id: 470, licitatie_id: 95, nume_original: 'PL1.pdf', analiza: { plansa: { cale_felii: 'x/470' } } }]
function ruleaza(uid: string, docId: number) {
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS })
  const deps = { SERVICE: 'service-key', API_KEY: 'k', supa, getUser, fetch: fakeFetch(n) }
  return handler(cerere(uid, { doc_id: docId }), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n }))
}
const zeroCost = (n: any) => { assertEquals(n.ai, 0, 'AI'); assertEquals(n.storage, 0, 'storage'); assertEquals(n.scrieri, 0, 'scrieri') }

Deno.test('poateCheltui: pur', () => {
  assert(poateCheltui({ is_owner: true, responsabil_id: null }, OWNER))
  assert(poateCheltui({ is_owner: false, responsabil_id: RESP }, RESP))
  assert(!poateCheltui({ is_owner: false, responsabil_id: RESP }, STRAIN))
  assert(!poateCheltui({ is_owner: false, responsabil_id: null }, STRAIN))
  assert(!poateCheltui({ is_owner: true, responsabil_id: null }, null))
  assert(!poateCheltui({}, ''))
})
Deno.test('plansa: user fără drept -> 403, zero cost', async () => {
  const r = await ruleaza(STRAIN, 470); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('plansa: responsabil pe ALTĂ licitație -> 403, zero cost', async () => {
  const r = await ruleaza(RESP_ALTA, 470); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('plansa: doc existent inaccesibil vs inexistent -> răspuns identic', async () => {
  const a = await ruleaza(STRAIN, 470), b = await ruleaza(STRAIN, 999999)
  assertEquals([a.status, a.corp], [b.status, b.corp]); zeroCost(a.n); zeroCost(b.n)
})
Deno.test('plansa: owner trece poarta (ajunge la storage)', async () => {
  const r = await ruleaza(OWNER, 470); assertEquals(r.status, 404); assert(r.corp.includes('nicio felie')); assertEquals(r.n.storage, 1)
})
Deno.test('plansa: owner, doc inexistent -> 404', async () => {
  const r = await ruleaza(OWNER, 999999); assertEquals(r.status, 404); assert(r.corp.includes('document inexistent')); zeroCost(r.n)
})
Deno.test('plansa: responsabil corect trece poarta', async () => {
  const r = await ruleaza(RESP, 470); assert(r.status !== 403); assertEquals(r.n.storage, 1)
})
Deno.test('plansa: token invalid -> 401, zero cost', async () => {
  const r = await ruleaza('invalid', 470); assertEquals(r.status, 401); zeroCost(r.n)
})
