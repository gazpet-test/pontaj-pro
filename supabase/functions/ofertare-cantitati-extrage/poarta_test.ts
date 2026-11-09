// deno test supabase/functions/ofertare-cantitati-extrage/poarta_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { cerere, cerereH, fakeFetch, fakeSupa, getUser, JWT_FALS_SERVICE, LICITATII, OWNER, PROFILE, RESP, RESP_ALTA, STRAIN } from '../_test/fake_supa.ts'

import { handler, MESAJ_STRUCTURAT } from './handler.ts'
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

// --- r4 (#908, review r3 Jakarinos P1-01): calea x-radar-secret e SCOASĂ — secretul (valid sau nu) nu mai autorizează nimic ---
function ruleazaH(headers: Record<string, string>, radarSecret?: string) {
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }, { radarSecret })
  const { supa } = cuPoartaLot(s0, DOCS.map((d) => d.id))
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' } }
  return handler(cerereH(headers, { licitatie_id: 95, max_felii: 1 }), deps).then(async (r) => ({ status: r.status, corp: await r.text(), n }))
}
Deno.test('cantitati r4: x-radar-secret VALID, fără JWT -> 401, zero cost, secretul nici nu se verifică', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-ok' }, 'rs-ok'); assertEquals(r.status, 401); assertEquals(r.n.rpcSecret, 0); zeroCost(r.n)
})
Deno.test('cantitati r4: x-radar-secret valid + JWT de utilizator fără drept -> 403 (secretul nu ține loc de poartă), zero cost', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-ok', Authorization: `Bearer ${STRAIN}` }, 'rs-ok'); assertEquals(r.status, 403); zeroCost(r.n)
})
Deno.test('cantitati: x-radar-secret greșit + JWT fals service_role -> 401, zero cost', async () => {
  const r = await ruleazaH({ 'x-radar-secret': 'rs-gresit', Authorization: `Bearer ${JWT_FALS_SERVICE}` }, 'rs-ok'); assertEquals(r.status, 401); zeroCost(r.n)
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

// --- TKT-0329 B: modul structurat ---
Deno.test('structurat: x-radar-secret (chiar valid) -> 403, zero cost', async () => {
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE, ofertare_licitatii: LICITATII, ofertare_documente_atribuire: DOCS }, { radarSecret: 'ok' })
  const { supa } = cuPoartaLot(s0, DOCS.map((d) => d.id))
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' } }
  const r = await handler(cerereH({ 'x-radar-secret': 'ok' }, { licitatie_id: 95, mod: 'structurat', cerere_id: 1 }), deps)
  assertEquals(r.status, 403); zeroCost(n)
})
Deno.test('structurat: fără cerere_id -> 402, zero cost; user fără drept -> 403', async () => {
  const a = await ruleaza(OWNER, { licitatie_id: 95, mod: 'structurat' }); assertEquals(a.status, 402); zeroCost(a.n)
  const b = await ruleaza(STRAIN, { licitatie_id: 95, mod: 'structurat', cerere_id: 1 }); assertEquals(b.status, 403); zeroCost(b.n)
})

// --- 1A (Răzvan 01.11.2026, #908 r2): excepția ADMIN din 17.10 („B”) e scoasă — adminul Ofertare care nu e owner / responsabil cu dovadă
// e refuzat ca oricine, ÎNAINTE de orice citire în cereri / buget și de orice apel AI; la fel când RPC-ul porții cade (fail-closed). ---
const ADMIN = 'u-admin-of', EDITOR = 'u-editor-of', ADMIN_ALT = 'u-admin-log'
const PROFILE_S = [...PROFILE, { id: ADMIN, is_owner: false }, { id: EDITOR, is_owner: false }, { id: ADMIN_ALT, is_owner: false }]
const UMA = [
  { profile_id: ADMIN, module: 'ofertare', access_level: 'admin' },
  { profile_id: EDITOR, module: 'ofertare', access_level: 'editor' },
  { profile_id: ADMIN_ALT, module: 'logistica', access_level: 'admin' },   // admin pe alt modul ≠ admin Ofertare
]
const viitor = () => new Date(Date.now() + 3600e3).toISOString()
const CERERE = () => ({ id: 7, licitatie_id: 95, scop: 'cant_extragere', stare: 'activa', valabil_pana: viitor(), lot_domeniu: 'toate', lot_nr: [] })
const BUGET = { licitatie_id: 95, scop: 'cant_extragere', plafon_usd: 5 as number | string, blocat: false, blocat_motiv: null as string | null }
// ACL-ul din 20261031a, simulat (Jakarinos r1 #753, P2): service_role NU are drept pe tabelele TKT-0329 B (cereri, buget, decizii,
// extrageri, felii) — citirea lor întoarce eroare de permisiune; clientul utilizatorului le vede (policy fn_are_acces_ofertare).
// `erori` = tabele unde citirea pică (eroare simulată pe acel client). `acces` = jurnalul citirilor pe client, inclusiv cele refuzate.
const EROARE_ACL = { code: '42501', message: 'permission denied' }
const DOAR_UTILIZATOR = ['ofertare_ai_cereri', 'ofertare_ai_buget', 'ofertare_cant_doc_decizii', 'ofertare_cant_extrageri', 'ofertare_cant_felii']
function cuACL<T extends { from: (t: string) => any }>(supa: T, erori: string[], acces: string[]): T {
  const negat = () => {
    const b: any = { select: () => b, eq: () => b, in: () => b, order: () => b, limit: () => b, not: () => b, like: () => b,
      maybeSingle: () => Promise.resolve({ data: null, error: EROARE_ACL }),
      then: (ok: any, ko: any) => Promise.resolve({ data: null, error: EROARE_ACL }).then(ok, ko) }
    return b
  }
  return { ...supa, from: (t: string) => { acces.push(t); return erori.includes(t) ? negat() : supa.from(t) } } as T
}
type OptS = { cereri?: Record<string, unknown>[]; buget?: Record<string, unknown>[]; req?: Request; eroareService?: string[]; eroareUtilizator?: string[]
  licitatii?: Record<string, unknown>[]; eroareCheltuiala?: boolean }
function ruleazaS(uid: string, body: Record<string, unknown>, o: OptS = {}) {
  // service_role: profiles, licitații, documente, user_module_access — FĂRĂ cereri / buget (nici nu le are în date, nici drept)
  const { supa: s0, n } = fakeSupa({ profiles: PROFILE_S, ofertare_licitatii: o.licitatii ?? LICITATII, ofertare_documente_atribuire: DOCS, user_module_access: UMA },
    { eroareCheltuiala: o.eroareCheltuiala })
  const accesService: string[] = [], accesUtilizator: string[] = [], jwts: string[] = []
  const { supa } = cuPoartaLot(cuACL(s0, [...DOAR_UTILIZATOR, ...(o.eroareService ?? [])], accesService), DOCS.map((d) => d.id))
  // utilizator (authenticated): cererile, bugetul, deciziile — ce îi dă RLS-ul
  const { supa: u0, n: nU } = fakeSupa({ ofertare_ai_cereri: o.cereri ?? [CERERE()], ofertare_ai_buget: o.buget ?? [BUGET], ofertare_cant_doc_decizii: [] })
  const usr = cuACL(u0, o.eroareUtilizator ?? [], accesUtilizator)
  const deps = { db: supa, getUser, fetch: fakeFetch(n), chei: { A: 'a', G: 'g', O: 'o' },
    dbUtilizator: (jwt: string) => { jwts.push(jwt); return usr } }
  return handler(o.req ?? cerere(uid, body), deps)
    .then(async (r) => ({ status: r.status, corp: await r.text(), n, nU, accesService, accesUtilizator, jwts }))
}
const S = { licitatie_id: 95, mod: 'structurat', cerere_id: 7 }
// trecut de poartă = a ajuns în extrageStructurat (răspunsul modului; documentele de test nu au text valid, deci 0 felii)
const trecut = (r: { status: number; corp: string }) => { assertEquals(r.status, 200, r.corp); assertEquals(JSON.parse(r.corp).mod, 'structurat') }
// refuz la poartă: 403, mesajul unic, fără motiv de admin, zero cost, nicio citire în cereri / buget, niciun client de utilizator
const refuzPoarta = (r: { status: number; corp: string; n: any; accesService: string[]; accesUtilizator: string[]; jwts: string[] }, cine: string) => {
  assertEquals(r.status, 403, `${cine}: ${r.corp}`); zeroCost(r.n)
  const j = JSON.parse(r.corp)
  assertEquals(j.error, MESAJ_STRUCTURAT); assertEquals(j.motiv, undefined)
  for (const t of ['ofertare_ai_cereri', 'ofertare_ai_buget', 'user_module_access']) assert(!r.accesService.includes(t) && !r.accesUtilizator.includes(t), `${cine} ${t}`)
  assertEquals(r.jwts, [], `${cine}: clientul utilizatorului nici nu e creat la poartă`)
}

Deno.test('structurat: owner trece (neschimbat)', async () => { trecut(await ruleazaS(OWNER, S)) })
Deno.test('structurat: owner trece la poartă și cu plafon > 5 / buget blocat (neschimbat; rezervarea decide)', async () => {
  trecut(await ruleazaS(OWNER, S, { buget: [{ ...BUGET, plafon_usd: 50, blocat: true, blocat_motiv: 'x' }] }))
})
Deno.test('structurat: responsabil (numire veche, regula A) trece (neschimbat)', async () => { trecut(await ruleazaS(RESP, S)) })
Deno.test('structurat/1A: admin Ofertare cu cerere activă exactă și plafon ≤ 5 -> REFUZ acum (excepția admin scoasă), zero cost', async () => {
  refuzPoarta(await ruleazaS(ADMIN, S), 'admin')
  refuzPoarta(await ruleazaS(ADMIN, S, { buget: [{ ...BUGET, plafon_usd: '5.00' }] }), 'admin plafon text')
  refuzPoarta(await ruleazaS(ADMIN, S, { buget: [{ ...BUGET, plafon_usd: 0.5 }] }), 'admin plafon mic')
})
Deno.test('structurat/1A: editor Ofertare, admin pe alt modul, străin -> refuz identic, fără citiri în cereri / buget', async () => {
  for (const u of [EDITOR, ADMIN_ALT, STRAIN]) refuzPoarta(await ruleazaS(u, S), u)
})
Deno.test('structurat/1A: RPC-ul porții căzut -> refuz și pentru admin / responsabil (fail-closed pe tot handler-ul), zero cost', async () => {
  for (const u of [ADMIN, RESP]) refuzPoarta(await ruleazaS(u, S, { eroareCheltuiala: true }), u)
})
Deno.test('structurat/1A: adminul numit responsabil de owner (dovadă 2A) trece — dreptul vine din numire, nu din rolul de admin', async () => {
  const lic = [{ id: 95, responsabil_id: ADMIN, responsabil_setat_de: OWNER, responsabil_numitor_autorizat: true }]
  trecut(await ruleazaS(ADMIN, S, { licitatii: lic }))
  // autoatribuit (dovada false) -> refuz
  refuzPoarta(await ruleazaS(ADMIN, S, { licitatii: [{ ...lic[0], responsabil_setat_de: ADMIN, responsabil_numitor_autorizat: false }] }), 'admin autoatribuit')
})
Deno.test('structurat: eroare de citire pe service_role (user_module_access / profiles) nu deschide nimic', async () => {
  refuzPoarta(await ruleazaS(ADMIN, S, { eroareService: ['user_module_access'] }), 'admin, uma căzut')
  // poarta unică e un RPC: un profiles căzut în PostgREST nu o atinge; owner-ul trece tot prin RPC
  trecut(await ruleazaS(OWNER, S, { eroareService: ['profiles'] }))
  refuzPoarta(await ruleazaS(ADMIN, S, { eroareService: ['profiles'] }), 'admin, profiles căzut')
})
Deno.test('structurat: anon (fără Authorization / JWT nevalidat de Auth / „Bearer ” gol) -> 401, zero cost', async () => {
  for (const h of [{}, { Authorization: `Bearer ${JWT_FALS_SERVICE}` }, { Authorization: 'Bearer ' }] as Record<string, string>[]) {
    const r = await ruleazaS('', S, { req: cerereH(h, S) }); assertEquals(r.status, 401, JSON.stringify(h)); zeroCost(r.n)
  }
})
Deno.test('structurat: x-radar-secret refuzat și pentru admin', async () => {
  const r = await ruleazaS(ADMIN, S, { req: cerereH({ 'x-radar-secret': 'ok', Authorization: `Bearer ${ADMIN}` }, S) })
  assertEquals(r.status, 403); zeroCost(r.n)
})
