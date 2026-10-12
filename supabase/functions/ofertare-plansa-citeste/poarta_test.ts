// deno test supabase/functions/ofertare-plansa-citeste/poarta_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, cerereH, fakeFetch, fakeSupa, getUser, JWT_FALS_SERVICE, LICITATII, OWNER, PROFILE, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'
import { poateCheltui } from './poarta.ts'

import { handler } from './handler.ts'

// LOTURI (20261024b): fake_supa e comun (și cu ofertare-cantitati-extrage) — poarta pe document se simulează AICI, peste rpc-ul lui:
// implicit eligibil; elig = răspunsul porții, 'eroare_rpc' = RPC căzut, 'arunca' = excepție. n.poarta = câte apeluri ale porții.
type Elig = { eligibil: boolean; motiv: string; licitatie_id: number } | 'eroare_rpc' | 'arunca'
function cuLoturi<T extends { supa: any; n: any }>(x: T, elig?: Elig): T & { n: T['n'] & { poarta: number } } {
  const rpc0 = x.supa.rpc
  x.n.poarta = 0
  x.supa.rpc = (name: string, a: any) => {
    if (name !== 'fn_ofertare_document_eligibil') return rpc0(name, a)
    x.n.poarta++
    const e = elig ?? { eligibil: true, motiv: 'fara_loturi', licitatie_id: 95 }
    if (e === 'arunca') return Promise.reject(new Error('rețea'))
    if (e === 'eroare_rpc') return Promise.resolve({ data: null, error: { message: 'function does not exist' } })
    return Promise.resolve({ data: e, error: null })
  }
  return x as T & { n: T['n'] & { poarta: number } }
}

// doc 470 (lic 95) are felii în storage (listă goală în fake => 404 „nicio felie", DUPĂ poartă)
const DOCS = [{ id: 470, licitatie_id: 95, fisier_path: 'PL1.pdf', nume_original: 'PL1.pdf', analiza: { plansa: { cale_felii: 'x/470' } } }]
function ruleaza(uid: string, docId: number) {
  const { supa, n } = cuLoturi(fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }))
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

// --- apel intern cu cheia service_role / header lipsă ---
function ruleazaH(headers: Record<string, string>, SERVICE = 'service-key') {
  const { supa, n } = cuLoturi(fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }))
  const deps = { SERVICE, API_KEY: 'k', supa, getUser, fetch: fakeFetch(n) }
  return handler(cerereH(headers, { doc_id: 470 }), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n }))
}
Deno.test('plansa: Bearer = service key valid -> trece poarta (ajunge la storage)', async () => {
  const r = await ruleazaH({ Authorization: 'Bearer service-key' }); assertEquals(r.status, 404); assert(r.corp.includes('nicio felie')); assertEquals(r.n.storage, 1)
})
Deno.test('plansa: service key greșit -> 401, zero cost', async () => {
  const r = await ruleazaH({ Authorization: 'Bearer service-kez.x.y' }); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('plansa: JWT nesemnat care pretinde role=service_role -> 401, zero cost', async () => {
  const r = await ruleazaH({ Authorization: `Bearer ${JWT_FALS_SERVICE}` }); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('plansa: Authorization absent -> 401, zero cost', async () => {
  const r = await ruleazaH({}); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('plansa: Authorization gol / doar "Bearer " -> 401, zero cost', async () => {
  for (const v of ['', 'Bearer ', 'Bearer']) { const r = await ruleazaH({ Authorization: v }); assertEquals(r.status, 401, `"${v}"`); zeroCost(r.n) }
})
Deno.test('plansa: SERVICE nesetat ("") nu face din header gol o cheie valabilă -> 401', async () => {
  for (const v of ['', 'Bearer ']) { const r = await ruleazaH({ Authorization: v }, ''); assertEquals(r.status, 401); zeroCost(r.n) }
})

// #494 r5: proveniența jobului se verifică înainte de orice rezervare sau AI, și la lipire.
Deno.test('plansa: asteptat diferit → 409, fără in_lucru, zero fetch/storage/scrieri pe citire și lipire', async () => {
  for (const doar_lipire of [false, true]) for (const asteptat of [
    { taiat_la: 'vechi', cale_felii: 'x/470' },
    { taiat_la: 't1', cale_felii: 'alta/cale' },
    { licitatie_id: 96 },
    { fisier_path: 'alta.pdf' },
    { fisier_path: 'pl1.pdf' },
    { fisier_path: 'PL1.pdf ' },
    { licitatie_id: null },
    { fisier_path: null },
    { taiat_la: null },
    { cale_felii: null },
  ]) {
    const doc = { ...DOCS[0], analiza: { plansa: { taiat_la: 't1', cale_felii: 'x/470' } } }
    const { supa, n } = cuLoturi(fakeSupa({ ofertare_documente_atribuire: [doc] }))
    const r = await handler(cerere('service-key', { doc_id: 470, doar_lipire, asteptat }),
      { SERVICE: 'service-key', API_KEY: 'k', supa, getUser, fetch: fakeFetch(n) })
    assertEquals(r.status, 409)
    assertEquals(await r.json(), { error: 'Documentul nu mai corespunde jobului — anulat', cost_usd: 0 })
    zeroCost(n)
  }
})

Deno.test('plansa: asteptat egal sau absent → comportament identic pe citire și lipire', async () => {
  for (const doar_lipire of [false, true]) for (const asteptat of [
    undefined, {}, { taiat_la: null, cale_felii: 'x/470' },
    { licitatie_id: 95 }, { licitatie_id: '95' }, { fisier_path: 'PL1.pdf' },
    { taiat_la: null }, { cale_felii: 'x/470' },
    { licitatie_id: '95', fisier_path: 'PL1.pdf', taiat_la: null, cale_felii: 'x/470' },
  ]) {
    const { supa, n } = cuLoturi(fakeSupa({ ofertare_documente_atribuire: DOCS }))
    const r = await handler(cerere('service-key', { doc_id: 470, doar_lipire, asteptat }),
      { SERVICE: 'service-key', API_KEY: 'k', supa, getUser, fetch: fakeFetch(n) })
    assertEquals(r.status, 404)
    assertEquals(await r.json(), { error: 'nicio felie in storage' })
    assertEquals([n.storage, n.ai, n.scrieri], [1, 0, 0])
  }
})

// ── LOTURI (20261024b) ───────────────────────────────────────────────────────────────────────────────────────────
const cereLot = (elig: Elig | undefined, body: Record<string, unknown>, uid = OWNER) => {
  const x = cuLoturi(fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }), elig)
  return handler(cerere(uid, { doc_id: 470, ...body }), { SERVICE: 'service-key', API_KEY: 'k', supa: x.supa, getUser, fetch: fakeFetch(x.n) })
    .then(async (r) => ({ status: r.status, j: await r.json(), n: x.n }))
}
Deno.test('plansa loturi: neeligibil → 200 {ok:false, blocat_lot, motiv}, zero AI / storage / scrieri — citire și doar_lipire', async () => {
  for (const doar_lipire of [false, true]) for (const motiv of ['loturi_neinitializate', 'nicio_participare', 'de_triat', 'in_afara_loturilor']) {
    const r = await cereLot({ eligibil: false, motiv, licitatie_id: 95 }, { doar_lipire })
    assertEquals(r.status, 200)
    assertEquals([r.j.ok, r.j.blocat_lot, r.j.motiv, r.j.cost_usd, r.j.continua], [false, true, motiv, 0, undefined])
    assert(String(r.j.error).startsWith('Blocat pe loturi: ')); zeroCost(r.n); assertEquals(r.n.poarta, 1)
  }
})
Deno.test('plansa loturi: eroare RPC / excepție → blocat (eroare_poarta), zero cost', async () => {
  for (const e of ['eroare_rpc', 'arunca'] as Elig[]) {
    const r = await cereLot(e, {}); assertEquals([r.status, r.j.blocat_lot, r.j.motiv], [200, true, 'eroare_poarta']); zeroCost(r.n)
  }
})
Deno.test('plansa loturi: user fără drept → 403 ÎNAINTE de poartă (nici măcar RPC-ul porții)', async () => {
  const r = await cereLot({ eligibil: false, motiv: 'de_triat', licitatie_id: 95 }, {}, STRAIN); assertEquals(r.status, 403); assertEquals(r.n.poarta, 0); zeroCost(r.n)
})
Deno.test('plansa loturi: eligibil (comun / lot_participam) → trece mai departe (ajunge la storage)', async () => {
  for (const motiv of ['comun', 'lot_participam']) {
    const r = await cereLot({ eligibil: true, motiv, licitatie_id: 95 }, {}); assertEquals(r.status, 404); assertEquals(r.n.storage, 1)
  }
})
