import { assert, assertEquals } from 'jsr:@std/assert@1'
import { ALLOWLIST, type Db, deschide, GOLIRE_MS, inchide, type Job, type StareF } from './fereastra.ts'

const MIN = 60_000
function lume(o: { coada?: number; hb?: number | null; veghe?: number | null; extraActiv?: boolean } = {}) {
  let t = 1_000_000_000
  const joburi: Job[] = ALLOWLIST.map((n, i) => ({ jobid: i + 1, jobname: n, active: n !== 'ofertare_participari_sapt', command: `select ${n}` }))
  joburi.push({ jobid: 100, jobname: 'dispecer', active: true, command: "select net.http_post('/functions/v1/ofertare-x')" })   // prins după comandă
  joburi.push({ jobid: 101, jobname: 'hr_zilnic', active: true, command: 'select hr()' })                                     // neatins
  const w = { coada: o.coada ?? 0, hb: o.hb === undefined ? t - 20 * MIN : o.hb, veghe: o.veghe === undefined ? t - 2 * 60 * MIN : o.veghe }
  let salvat: StareF | null = null, salvari = 0
  const db: Db = {
    joburi: async () => joburi.map((j) => ({ ...j })),
    seteazaActiv: async (id, a) => { joburi.find((j) => j.jobid === id)!.active = a },
    coada: async () => w.coada, heartbeat: async () => w.hb, vegheUltimaRulare: async () => w.veghe, acum: () => t,
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
