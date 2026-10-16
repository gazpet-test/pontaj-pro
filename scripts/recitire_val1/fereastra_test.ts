import { assert, assertEquals } from 'jsr:@std/assert@1'
import { ALLOWLIST, type Db, deschide, GOLIRE_MS, inchide, type Job, type StareF, ultimaProgramare } from './fereastra.ts'

const MIN = 60_000
function lume(o: { coada?: number; hb?: number | null; veghe?: number | null; inCurs?: number } = {}) {
  let t = 1_000_000_000
  const joburi: Job[] = ALLOWLIST.map((n, i) => ({ jobid: i + 1, jobname: n, active: n !== 'ofertare_participari_sapt', command: `select ${n}`,
    schedule: n === 'ofertare_seap_veghe_0520' ? '20 5 * * *' : n === 'ofertare_seap_veghe_1250' ? '50 12 * * *' : '* * * * *' }))
  joburi.push({ jobid: 100, jobname: 'dispecer', active: true, command: "select net.http_post('/functions/v1/ofertare-x')" })   // prins după comandă
  joburi.push({ jobid: 101, jobname: 'hr_zilnic', active: true, command: 'select hr()' })                                     // neatins
  const w = { coada: o.coada ?? 0, hb: o.hb === undefined ? t - 20 * MIN : o.hb, veghe: o.veghe === undefined ? t - 2 * 60 * MIN : o.veghe, inCurs: o.inCurs ?? 0 }
  let salvat: StareF | null = null, salvari = 0
  const db: Db = {
    joburi: async () => joburi.map((j) => ({ ...j })),
    seteazaActiv: async (id, a) => { joburi.find((j) => j.jobid === id)!.active = a },
    coada: async () => w.coada, heartbeat: async () => w.hb, vegheUltimaRulare: async () => w.veghe, inCurs: async () => w.inCurs, acum: () => t,
  }
  const salveaza = async (s: StareF) => { salvari++; salvat = structuredClone(s) }
  return { db, joburi, w, salveaza, avans: (ms: number) => { t += ms }, salvat: () => salvat, salvari: () => salvari, t: () => t }
}

Deno.test('fereastra: deschide → golire T_gol + 15 min → GATA; joburile țintă oprite, celelalte neatinse', async () => {
  const L = lume()
  let r = await deschide(L.db, null, L.salveaza)
  assertEquals(r.cod, 5)
  assert(L.joburi.filter((j) => ALLOWLIST.includes(j.jobname!) || j.jobid === 100).every((j) => !j.active))
  assertEquals(L.joburi.find((j) => j.jobid === 101)!.active, true)
  L.avans(GOLIRE_MS - MIN); r = await deschide(L.db, L.salvat(), L.salveaza); assertEquals(r.cod, 5)
  L.avans(MIN); r = await deschide(L.db, L.salvat(), L.salveaza); assertEquals(r.cod, 0)
})

Deno.test('fereastra: deschide → deschide → închide nu pierde starea inițială (snapshot o singură dată)', async () => {
  const L = lume()
  await deschide(L.db, null, L.salveaza)
  const s1 = L.salvat()!
  await deschide(L.db, s1, L.salveaza)
  assertEquals(L.salvat()!.joburi, s1.joburi)                          // joburile salvate au rămas cele inițiale (active)
  const r = await inchide(L.db, L.salvat(), L.salveaza)
  assertEquals(r.cod, 0)
  assertEquals(L.joburi.find((j) => j.jobname === 'ofertare_ingest_worker')!.active, true)
  assertEquals(L.joburi.find((j) => j.jobname === 'ofertare_participari_sapt')!.active, false)   // era inactiv → rămâne
  assertEquals(L.salvat()!.stare, 'CLOSED')
  assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 2)   // o fereastră închisă nu se redeschide în același director
})

Deno.test('fereastra: o cerere în zbor (coada golită târziu) — T_gol se ia la golire, nu la oprire', async () => {
  const L = lume({ coada: 1 })
  assertEquals((await deschide(L.db, null, L.salveaza)).cod, 5)
  L.avans(7 * MIN); L.w.coada = 0
  assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 5)
  const tGol = L.salvat()!.t_gol!
  assertEquals(tGol, L.t())
  L.avans(GOLIRE_MS - 1); assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 5)
  L.avans(1); assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 0)
})

Deno.test('fereastra: veghea SEAP recentă și worker-ul NAS viu blochează golirea', async () => {
  const L = lume({ veghe: 1_000_000_000 - 10 * MIN })
  assert(/veghea SEAP/.test((await deschide(L.db, null, L.salveaza)).mesaj))
  const N = lume({ hb: 1_000_000_000 - MIN })
  const r = await deschide(N.db, null, N.salveaza)
  assert(/worker-ul NAS/.test(r.mesaj))
  assertEquals(N.salvat()!.nas_pornit, true)
})

Deno.test('fereastra: închiderea la eroare repornește joburile; NAS pornit inițial → cere pornirea și verifică heartbeat-ul', async () => {
  const L = lume({ hb: 1_000_000_000 - MIN })
  await deschide(L.db, null, L.salveaza)
  L.w.hb = L.t() - 30 * MIN                                        // NAS oprit de chat
  let r = await inchide(L.db, L.salvat(), L.salveaza)
  assertEquals(r.cod, 6)
  assertEquals(L.joburi.find((j) => j.jobname === 'ofertare_ingest_worker')!.active, true)   // joburile deja restaurate
  L.w.hb = L.t(); r = await inchide(L.db, L.salvat(), L.salveaza)
  assertEquals([r.cod, L.salvat()!.stare], [0, 'CLOSED'])
})

Deno.test('fereastra: un job din allowlist lipsă → refuz fără nicio schimbare', async () => {
  const L = lume()
  L.joburi.splice(0, 1)
  const r = await deschide(L.db, null, L.salveaza)
  assertEquals(r.cod, 2)
  assertEquals(L.salvari(), 0)
  assert(L.joburi.some((j) => j.active))
})

Deno.test('r1: o rulare cron Ofertare încă în curs → nu poate da GATA', async () => {
  const L = lume({ inCurs: 1 })
  await deschide(L.db, null, L.salveaza)
  L.avans(GOLIRE_MS + MIN)
  const r = await deschide(L.db, L.salvat(), L.salveaza)
  assertEquals(r.cod, 5)
  assert(/în curs/.test(r.mesaj))
})

Deno.test('r1: un job din allowlist șters după prima rulare → refuz la rularea următoare, niciodată GATA', async () => {
  const L = lume()
  await deschide(L.db, null, L.salveaza)
  L.joburi.splice(L.joburi.findIndex((j) => j.jobname === 'ofertare_radar_0500'), 1)
  L.avans(GOLIRE_MS + MIN)
  assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 2)
})

Deno.test('r1: un job reactivat după golire → reoprit ȘI golirea de la capăt (nu GATA imediat)', async () => {
  const L = lume()
  await deschide(L.db, null, L.salveaza)
  L.avans(GOLIRE_MS + MIN)
  assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 0)
  L.joburi.find((j) => j.jobname === 'ofertare_ingest_worker')!.active = true
  L.avans(MIN)
  assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 5)
  assertEquals(L.joburi.find((j) => j.jobname === 'ofertare_ingest_worker')!.active, false)
  L.avans(GOLIRE_MS - 2 * MIN); assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 5)
  L.avans(3 * MIN); assertEquals((await deschide(L.db, L.salvat(), L.salveaza)).cod, 0)
})

Deno.test('r1: distanța față de programarea veghei SEAP (UTC) — sub 30 min → așteaptă', async () => {
  const acum = Date.UTC(2026, 9, 16, 13, 5)                   // 13:05 UTC, la 15 min după 12:50
  assertEquals(ultimaProgramare('50 12 * * *', acum), Date.UTC(2026, 9, 16, 12, 50))
  assertEquals(ultimaProgramare('20 5 * * *', Date.UTC(2026, 9, 16, 4, 0)), Date.UTC(2026, 9, 15, 5, 20))
  assertEquals(ultimaProgramare('*/5 * * * *', acum), null)
  const L = lume()
  L.avans(Date.UTC(1970, 0, 12, 13, 5) - L.t())              // ceasul lumii la 13:05 UTC
  const r = await deschide(L.db, null, L.salveaza)
  assert(/programarea ofertare_seap_veghe_1250/.test(r.mesaj))
})

Deno.test('r1: un job Ofertare NOU (absent din snapshot) → refuz și rămâne neatins', async () => {
  const L = lume()
  await deschide(L.db, null, L.salveaza)
  L.joburi.push({ jobid: 200, jobname: 'ofertare_nou', active: true, command: 'select ofertare_x()' })
  const r = await deschide(L.db, L.salvat(), L.salveaza)
  assertEquals(r.cod, 2)
  assertEquals(L.joburi.find((j) => j.jobid === 200)!.active, true)
})
