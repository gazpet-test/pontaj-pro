// Recitirea valului 1 (procedura §5, „Fereastra”): deschiderea / verificarea / închiderea ferestrei de mentenanță.
//   deno run -A scripts/recitire_val1/fereastra.ts deschide <dir>   — idempotent: refolosește <dir>/fereastra_stare.json (OPEN), nu-l rescrie
//   deno run -A scripts/recitire_val1/fereastra.ts inchide <dir>    — reactivează EXACT joburile active inițial; la ORICE eroare după deschidere
// Coduri: 0 = gata (deschisă și golită / închisă) · 5 = de așteptat / de reluat (mesajul spune ce) · 6 = pornește worker-ul NAS și reia ·
//         2 = mediu / refuz. Mediu: RV1_PG_URL (conexiunea postgres, ca la psql). Worker-ul NAS îl oprește / pornește chat-ul pe server;
//         scriptul doar verifică heartbeat-ul. Anunțul către utilizatori = decizia lui Răzvan, NU un pas al scriptului.
export const ALLOWLIST = ['ofertare_ingest_worker', 'ofertare_extragere_worker', 'ofertare_seap_veghe_0520', 'ofertare_seap_veghe_1250',
  'ofertare_radar_0500', 'ofertare_radar_1230', 'ofertare_raport_zilnic_0430', 'ofertare_alerte_0540', 'ofertare_alerte_1310',
  'ofertare_alerte_atentie_0630', 'ofertare_alerta_pagini_goale_0615', 'ofertare_clarificari_reminder_0600', 'ofertare_participari_sapt']
export const VEGHE = ['ofertare_seap_veghe_0520', 'ofertare_seap_veghe_1250']
export const NAS = 'ofertare-worker'
const MIN = 60_000
export const GOLIRE_MS = 15 * MIN, HEARTBEAT_OPRIT_MS = 10 * MIN, DUPA_VEGHE_MS = 30 * MIN

export type Job = { jobid: number; jobname: string | null; active: boolean; command: string }
export type Db = {
  joburi: () => Promise<Job[]>
  seteazaActiv: (jobid: number, activ: boolean) => Promise<void>
  coada: () => Promise<number>                         // net.http_request_queue
  heartbeat: () => Promise<number | null>               // worker_heartbeat.ultimul (ms) pentru NAS
  vegheUltimaRulare: () => Promise<number | null>        // max(end_time / start_time) al joburilor de veghe SEAP (ms)
  acum: () => number
}
export type StareF = { run_id: string; stare: 'OPEN' | 'CLOSED'; creat_la: number; joburi: Job[]; nas_pornit: boolean
  t_joburi_oprite: number | null; t_stop: number | null; t_gol: number | null }
export type Rezultat = { cod: 0 | 2 | 5 | 6; mesaj: string; stare: StareF | null }
const tinta = (j: Job) => ALLOWLIST.includes(j.jobname ?? '') || /ofertare/i.test(j.command)

export async function deschide(db: Db, st: StareF | null, salveaza: (s: StareF) => Promise<void>): Promise<Rezultat> {
  if (st?.stare === 'CLOSED') return { cod: 2, mesaj: 'fereastra din acest director e ÎNCHISĂ; o fereastră nouă = alt director', stare: st }
  if (!st) {
    const joburi = await db.joburi()
    const lipsa = ALLOWLIST.filter((n) => !joburi.some((j) => j.jobname === n))
    if (lipsa.length) return { cod: 2, mesaj: `joburi din allowlist absente (redenumite?): ${lipsa.join(', ')} — nimic schimbat`, stare: null }
    const hb = await db.heartbeat()
    // starea inițială se salvează O SINGURĂ DATĂ, ÎNAINTEA oricărei schimbări
    st = { run_id: crypto.randomUUID(), stare: 'OPEN', creat_la: db.acum(), joburi, nas_pornit: hb !== null && db.acum() - hb < HEARTBEAT_OPRIT_MS,
      t_joburi_oprite: null, t_stop: null, t_gol: null }
    await salveaza(st)
  }
  for (const j of st.joburi.filter(tinta)) {
    const acum = (await db.joburi()).find((x) => x.jobid === j.jobid)
    if (acum?.active) await db.seteazaActiv(j.jobid, false)
  }
  const dupa = await db.joburi()
  const active = dupa.filter((j) => tinta(j) && j.active)
  if (active.length) return { cod: 2, mesaj: `joburi încă active: ${active.map((j) => j.jobname).join(', ')}`, stare: st }
  const noi = dupa.filter((j) => tinta(j) && !st!.joburi.some((x) => x.jobid === j.jobid))
  if (noi.length) return { cod: 2, mesaj: `joburi Ofertare apărute după deschidere: ${noi.map((j) => j.jobname).join(', ')}`, stare: st }
  if (st.t_joburi_oprite === null) { st.t_joburi_oprite = db.acum(); await salveaza(st) }
  const veghe = await db.vegheUltimaRulare()
  if (veghe !== null && db.acum() - veghe < DUPA_VEGHE_MS) return { cod: 5, mesaj: `veghea SEAP a rulat acum ${Math.round((db.acum() - veghe) / MIN)} min; reia după 30 min`, stare: st }
  const hb = await db.heartbeat()
  if (hb !== null && db.acum() - hb < HEARTBEAT_OPRIT_MS) return { cod: 5, mesaj: 'oprește worker-ul NAS (ofertare-worker); heartbeat-ul trebuie să fie mai vechi de 10 min', stare: st }
  if (st.t_stop === null) { st.t_stop = Math.max(st.t_joburi_oprite, hb ?? 0); await salveaza(st) }
  const coada = await db.coada()
  if (coada > 0) return { cod: 5, mesaj: `coada pg_net are ${coada} cereri; reia`, stare: st }
  if (st.t_gol === null) { st.t_gol = db.acum(); await salveaza(st) }
  const ramas = st.t_gol + GOLIRE_MS - db.acum()
  if (ramas > 0) return { cod: 5, mesaj: `golire: mai sunt ${Math.ceil(ramas / MIN)} min (T_gol + 15 min)`, stare: st }
  if ((await db.coada()) > 0) return { cod: 5, mesaj: 'coada pg_net nu mai e goală; reia', stare: st }
  return { cod: 0, mesaj: 'GATA: fereastră deschisă și golită', stare: st }
}

export async function inchide(db: Db, st: StareF | null, salveaza: (s: StareF) => Promise<void>): Promise<Rezultat> {
  if (!st) return { cod: 2, mesaj: 'nicio stare salvată; nimic de restaurat', stare: null }
  if (st.stare === 'CLOSED') return { cod: 0, mesaj: 'deja închisă', stare: st }
  for (const j of st.joburi.filter((x) => x.active)) {
    const acum = (await db.joburi()).find((x) => x.jobid === j.jobid)
    if (acum && !acum.active) await db.seteazaActiv(j.jobid, true)
  }
  const dupa = await db.joburi()
  const gresite = st.joburi.filter((j) => dupa.find((x) => x.jobid === j.jobid)?.active !== j.active)
  if (gresite.length) return { cod: 2, mesaj: `joburi nerestaurate: ${gresite.map((j) => j.jobname).join(', ')}`, stare: st }
  if (st.nas_pornit) {
    const hb = await db.heartbeat()
    if (hb === null || db.acum() - hb >= HEARTBEAT_OPRIT_MS) return { cod: 6, mesaj: 'joburile sunt restaurate; pornește worker-ul NAS (era pornit) și reia inchide', stare: st }
  }
  st.stare = 'CLOSED'; await salveaza(st)
  return { cod: 0, mesaj: 'fereastră închisă: joburile și worker-ul NAS readuse la starea inițială', stare: st }
}

if (import.meta.main) {
  const [cmd, dir] = Deno.args
  if (!['deschide', 'inchide'].includes(cmd) || !dir) { console.error('utilizare: fereastra.ts deschide|inchide <dir>'); Deno.exit(2) }
  const url = Deno.env.get('RV1_PG_URL'); if (!url) { console.error('lipsește RV1_PG_URL'); Deno.exit(2) }
  const { Client } = await import('https://deno.land/x/postgres@v0.19.3/mod.ts')
  const c = new Client(url); await c.connect()
  const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null)
  const db: Db = {
    joburi: async () => (await c.queryObject<Job>('SELECT jobid::int AS jobid, jobname, active, command FROM cron.job ORDER BY jobid')).rows,
    seteazaActiv: async (id, a) => { await c.queryArray('SELECT cron.alter_job(job_id := $1, active := $2)', [id, a]) },
    coada: async () => Number((await c.queryArray('SELECT count(*) FROM net.http_request_queue')).rows[0][0]),
    heartbeat: async () => ms((await c.queryArray('SELECT ultimul FROM public.worker_heartbeat WHERE nume = $1', [NAS])).rows[0]?.[0]),
    vegheUltimaRulare: async () => ms((await c.queryArray(
      `SELECT max(coalesce(d.end_time, d.start_time)) FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = ANY($1)`, [VEGHE])).rows[0]?.[0]),
    acum: () => Date.now(),
  }
  const fis = `${dir}/fereastra_stare.json`
  let st: StareF | null = null
  try { st = JSON.parse(await Deno.readTextFile(fis)) } catch { st = null }
  const salveaza = async (s: StareF) => { await Deno.writeTextFile(fis + '.tmp', JSON.stringify(s, null, 1)); await Deno.rename(fis + '.tmp', fis) }
  const r = cmd === 'deschide' ? await deschide(db, st, salveaza) : await inchide(db, st, salveaza)
  await c.end()
  console.log(`${r.cod === 0 ? 'OK' : 'ATENȚIE'} [${r.cod}] ${r.mesaj}`)
  Deno.exit(r.cod)
}
