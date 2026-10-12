// deno test supabase/functions/ofertare-cantitati-extrage/poarta_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, cerereH, fakeFetch, fakeSupa, getUser, JWT_FALS_SERVICE, LICITATII, OWNER, PROFILE, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'

import { handler } from './handler.ts'
import { cuPoartaLot } from '../_test/poarta_lot.ts'

const DOCS = [{ id: 1, licitatie_id: 95, nume_original: 'F3.pdf', tip: 'lista_cantitati', text_extras: 'x'.repeat(800) }]
function ruleaza(uid: string, body: Record<string, unknown>, docs: Record<string, unknown>[] = DOCS,
  lot: { motive?: Record<number, string>; cade?: boolean } = {}) {
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: docs })
  const { supa, apeluri } = cuPoartaLot(s0, docs.map((d) => Number(d.id)), lot)
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' } }
  return handler(cerere(uid, body), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n, apeluri }))
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
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }, { radarSecret })
  const { supa } = cuPoartaLot(s0, DOCS.map((d) => d.id))
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

// --- poarta pe loturi (20261024b) + lotul canonic din numele documentului ---
const DOC_LOT12 = { id: 2, licitatie_id: 95, nume_original: 'F3 Lot 12.pdf', tip: 'lista_cantitati', text_extras: 'y'.repeat(800) }
const randuri = (n: any) => n.upsertate.filter((u: any) => u.tabel === 'ofertare_cantitati').flatMap((u: any) => u.rows)
Deno.test('cantitati/loturi: document neeligibil → zero AI, zero scrieri, mesaj de business cu documentul oprit', async () => {
  const r = await ruleaza(OWNER, { licitatie_id: 95 }, DOCS, { motive: { 1: 'in_afara_loturilor' } })
  assertEquals(r.status, 200); zeroCost(r.n)
  const j = JSON.parse(r.corp)
  assertEquals([j.ok, j.blocat_lot, j.motiv], [false, true, 'in_afara_loturilor'])
  assertEquals(j.excluse_lot.map((x: any) => [x.id, x.motiv]), [[1, 'in_afara_loturilor']])
  assertEquals(r.apeluri, [{ nume: 'fn_ofertare_eligibilitate', args: { p_licitatie_id: 95 } }])
})
Deno.test('cantitati/loturi: poarta căzută → nimic procesat (fail-closed), nici la dry_run', async () => {
  for (const dry_run of [false, true]) {
    const r = await ruleaza(OWNER, { licitatie_id: 95, dry_run }, DOCS, { cade: true })
    assertEquals(r.status, 200); zeroCost(r.n)
    const j = JSON.parse(r.corp)
    assertEquals([j.ok, j.blocat_lot, j.motiv], [false, true, 'eroare_poarta'])
  }
})
Deno.test('cantitati/loturi: neinițializat (inclusiv fișa) — fără excepții în cod', async () => {
  const r = await ruleaza(OWNER, { licitatie_id: 95 }, DOCS, { motive: { 1: 'loturi_neinitializate' } })
  zeroCost(r.n); assertEquals(JSON.parse(r.corp).motiv, 'loturi_neinitializate')
})
Deno.test('cantitati/loturi: doar cel eligibil ajunge la AI; rândurile poartă lotul din numele documentului', async () => {
  const r = await ruleaza(OWNER, { licitatie_id: 95 }, [...DOCS, DOC_LOT12, { ...DOC_LOT12, id: 3, nume_original: 'F3 Lot 5.pdf' }],
    { motive: { 3: 'de_triat' } })
  assertEquals(r.status, 200); assertEquals(r.n.ai, 2)
  const j = JSON.parse(r.corp)
  assertEquals(j.excluse_lot.map((x: any) => [x.id, x.motiv]), [[3, 'de_triat']])
  const rows = randuri(r.n)
  const lot = (sursa: string) => rows.filter((x: any) => x.sursa.startsWith(sursa)).map((x: any) => [x.lot_domeniu, x.lot_nr, x.lot_sursa, x.lot_brut])
  assertEquals(lot('F3 Lot 12.pdf'), [['lista', [12], 'nume_fisier', 'Lot 12']])
  assertEquals(lot('F3.pdf'), [['necunoscut', null, 'nume_fisier', null]])   // fără lot în nume = necunoscut, NU toate
  assert(rows.every((x: any) => !('lot' in x)), 'coloana veche lot nu se scrie aici (nici înainte nu se scria)')
})
