// deno test supabase/functions/ofertare-cantitati-extrage/poarta_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, cerereH, fakeFetch, fakeSupa, getUser, JWT_FALS_SERVICE, LICITATII, OWNER, PROFILE, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'

import { handler } from './handler.ts'

const DOCS = [{ id: 1, licitatie_id: 95, nume_original: 'F3.pdf', tip: 'lista_cantitati', text_extras: 'x'.repeat(800) }]
function ruleaza(uid: string, body: Record<string, unknown>) {
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS })
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' } }
  return handler(cerere(uid, body), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n }))
}
const zeroCost = (n: any) => { assertEquals(n.ai, 0, 'AI'); assertEquals(n.storage, 0, 'storage'); assertEquals(n.scrieri, 0, 'scrieri') }

Deno.test('cantitati: user fără drept -> 403, zero cost', async () => {
  const r = await ruleaza(STRAIN, { licitatie_id: 95, dry_run: true, max_felii: 1 }); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('cantitati: responsabil pe ALTĂ licitație -> 403, zero cost', async () => {
  const r = await ruleaza(RESP_ALTA, { licitatie_id: 95 }); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('cantitati: licitație existentă inaccesibilă vs inexistentă -> răspuns identic', async () => {
  const a = await ruleaza(STRAIN, { licitatie_id: 95 }), b = await ruleaza(STRAIN, { licitatie_id: 999999 })
  assertEquals([a.status, a.corp], [b.status, b.corp]); zeroCost(a.n); zeroCost(b.n)
})
Deno.test('cantitati: owner trece; dry_run = previzualizare plătită (AI + jurnal, fără upsert)', async () => {
  const r = await ruleaza(OWNER, { licitatie_id: 95, dry_run: true, max_felii: 1 })
  assertEquals(r.status, 200)
  const j = JSON.parse(r.corp)
  assertEquals(j.previzualizare_platita, true); assertEquals(j.dry_run, true)
  assertEquals(r.n.ai, 1); assertEquals(r.n.scrieri, 1) // doar ai_usage_log
})
Deno.test('cantitati: responsabil corect trece și scrie (non dry_run)', async () => {
  const r = await ruleaza(RESP, { licitatie_id: 95, max_felii: 1 })
  assertEquals(r.status, 200); assertEquals(r.n.ai, 1); assertEquals(r.n.scrieri, 2) // jurnal + upsert
})
Deno.test('cantitati: token invalid -> 401, zero cost', async () => {
  const r = await ruleaza('invalid', { licitatie_id: 95 }); assertEquals(r.status, 401); zeroCost(r.n)
})

// --- calea worker x-radar-secret ---
function ruleazaH(headers: Record<string, string>, radarSecret?: string) {
  const { supa, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }, { radarSecret })
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' } }
  return handler(cerereH(headers, { licitatie_id: 95, max_felii: 1 }), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n }))
}
Deno.test('cantitati: x-radar-secret valid -> trece (fără JWT)', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-ok' }, 'rs-ok'); assertEquals(r.status, 200); assertEquals(r.n.ai, 1)
})
Deno.test('cantitati: x-radar-secret greșit, fără JWT -> 401, zero cost', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-gresit' }, 'rs-ok'); assertEquals(r.status, 401); assertEquals(r.n.rpcSecret, 1); zeroCost(r.n)
})
Deno.test('cantitati: x-radar-secret greșit + JWT fals service_role -> 401, zero cost', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-gresit', Authorization: `Bearer ${JWT_FALS_SERVICE}` }, 'rs-ok'); assertEquals(r.status, 401); zeroCost(r.n)
})
Deno.test('cantitati: secret NECONFIGURAT (undefined/"") + header absent sau gol -> NU autorizează', async () => {
  for (const cfg of [undefined, '']) {
    for (const h of [{}, { 'x-radar-secret': '' }, { 'x-radar-secret': '   ' }] as Record<string, string>[]) {
      const r = await ruleazaH(h, cfg); assertEquals(r.status, 401, `cfg=${JSON.stringify(cfg)} h=${JSON.stringify(h)}`)
      assertEquals(r.n.rpcSecret, 0, 'header gol nu ajunge nici la RPC'); zeroCost(r.n)
    }
  }
})
Deno.test('cantitati: secret neconfigurat + header nenul -> 401 (RPC întoarce false)', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'orice' }, undefined); assertEquals(r.status, 401); assertEquals(r.n.rpcSecret, 1); zeroCost(r.n)
})
Deno.test('cantitati: Authorization gol / doar "Bearer " -> 401, zero cost', async () => {
  for (const v of ['', 'Bearer ']) { const r = await ruleazaH({ Authorization: v }, 'rs-ok'); assertEquals(r.status, 401); zeroCost(r.n) }
})
