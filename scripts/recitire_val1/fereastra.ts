// Recitirea valului 1 (procedura §5, „Fereastra”): deschiderea / verificarea / închiderea ferestrei de mentenanță.
//   deno run -A scripts/recitire_val1/fereastra.ts deschide <dir_val>/fereastra_N   — idempotent: refolosește fereastra_stare.json (OPEN), nu-l rescrie
//   deno run -A scripts/recitire_val1/fereastra.ts inchide <dir_val>/fereastra_N    — reactivează EXACT joburile active inițial; la ORICE eroare după deschidere
// Coduri: 0 = gata (deschisă și golită / închisă) · 5 = de așteptat / de reluat (mesajul spune ce) · 6 = pornește worker-ul NAS și reia ·
//         2 = mediu / refuz. Mediu: RV1_PG_URL (conexiunea postgres, ca la psql). Worker-ul NAS îl oprește / pornește chat-ul pe server;
//         scriptul doar verifică heartbeat-ul. Anunțul către utilizatori = decizia lui Răzvan, NU un pas al scriptului.
import { caSupabase, categorieEroare, optiuniDeno, parseazaUrl } from './conexiune.ts'
export const ALLOWLIST = ['ofertare_ingest_worker', 'ofertare_extragere_worker', 'ofertare_seap_veghe_0520', 'ofertare_seap_veghe_1250',
  'ofertare_radar_0500', 'ofertare_radar_1230', 'ofertare_raport_zilnic_0430', 'ofertare_alerte_0540', 'ofertare_alerte_1310',
  'ofertare_alerte_atentie_0630', 'ofertare_alerta_pagini_goale_0615', 'ofertare_clarificari_reminder_0600', 'ofertare_participari_sapt']
export const VEGHE = ['ofertare_seap_veghe_0520', 'ofertare_seap_veghe_1250']
export const NAS = 'ofertare-worker'
// coada pg_net: se numără DOAR cererile spre funcțiile edge Ofertare. Joburile altor module (redirect-mai-gov la fiecare minut,
// rag_utilaj_*, egress_detector_5min …) țin coada GLOBALĂ mereu ocupată (16.10, fereastra_1: 1→3→2→2 în 15 min), iar ele nu ating
// documentele Ofertare. Toți producătorii Ofertare din allowlist cheamă /functions/v1/ofertare-* (direct sau prin ofertare_ingest_tick /
// ofertare_extragere_tick); lanțul veghe → import ocolește coada și e acoperit de T_gol + 15 min și de distanța de 30 min (§5).
// + vercel-relay (Jakarinos, #746): releul pornește și seap-import / plansa-felii / pdf-sparge pe Vercel (api/seap-import.js scrie
// documente Ofertare), deci TOATE cererile lui intră în golire, conservator (azi îl cheamă din cron doar joburile HR, preluate în 1–2 min).
export const SQL_COADA_OFERTARE = `SELECT count(*) FROM net.http_request_queue WHERE url ILIKE '%/functions/v1/ofertare-%' OR url ILIKE '%/functions/v1/vercel-relay%'`
const MIN = 60_000
export const GOLIRE_MS = 15 * MIN, HEARTBEAT_OPRIT_MS = 10 * MIN, DUPA_VEGHE_MS = 30 * MIN

export type Job = { jobid: number; jobname: string | null; active: boolean; command: string; schedule?: string }
export type Db = {
  joburi: () => Promise<Job[]>
  seteazaActiv: (jobid: number, activ: boolean) => Promise<void>
  coada: () => Promise<number>                         // net.http_request_queue, DOAR cererile spre funcțiile Ofertare (SQL_COADA_OFERTARE)
  heartbeat: () => Promise<number | null>               // worker_heartbeat.ultimul (ms) pentru NAS
  vegheUltimaRulare: () => Promise<number | null>        // max(end_time / start_time) al joburilor de veghe SEAP (ms)
  inCurs: (jobids: number[]) => Promise<number>          // cron.job_run_details cu status 'running' pe aceste joburi
  acum: () => number
}
export type StareF = { run_id: string; stare: 'OPEN' | 'CLOSED'; creat_la: number; joburi: Job[]; nas_pornit: boolean
  t_joburi_oprite: number | null; t_stop: number | null; t_gol: number | null }
export type Rezultat = { cod: 0 | 2 | 5 | 6; mesaj: string; stare: StareF | null }
const tinta = (j: Job) => ALLOWLIST.includes(j.jobname ?? '') || /ofertare/i.test(j.command)
// ultima programare (UTC, ca pg_cron) ≤ acum pentru un orar „m h * * *”; alt format → null (refuz: nu se poate verifica)
export function ultimaProgramare(schedule: string, acum: number): number | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim())
  if (!m) return null
  const d = new Date(acum)
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Number(m[2]), Number(m[1]))
  if (t > acum) t -= 24 * 60 * MIN
  return t
}

export async function deschide(db: Db, st: StareF | null, salveaza: (s: StareF) => Promise<void>): Promise<Rezultat> {
  if (st?.stare === 'CLOSED') return { cod: 2, mesaj: 'fereastra din acest director e ÎNCHISĂ; o fereastră nouă = alt director', stare: st }
  // allowlist-ul se verifică la FIECARE rulare (un job redenumit / șters între rulări → refuz, niciodată GATA)
  const toate = await db.joburi()
  const lipsa = ALLOWLIST.filter((n) => !toate.some((j) => j.jobname === n))
  if (lipsa.length) return { cod: 2, mesaj: `joburi din allowlist absente (redenumite?): ${lipsa.join(', ')}${st ? '' : ' — nimic schimbat'}`, stare: st }
  if (!st) {
    const joburi = await db.joburi()
    const hb = await db.heartbeat()
    // starea inițială se salvează O SINGURĂ DATĂ, ÎNAINTEA oricărei schimbări
    st = { run_id: crypto.randomUUID(), stare: 'OPEN', creat_la: db.acum(), joburi, nas_pornit: hb !== null && db.acum() - hb < HEARTBEAT_OPRIT_MS,
      t_joburi_oprite: null, t_stop: null, t_gol: null }
    await salveaza(st)
  }
  // un job Ofertare NOU (absent din snapshot) → refuz FĂRĂ să-l ating (închiderea nu l-ar ști restaura)
  const noi0 = (await db.joburi()).filter((j) => tinta(j) && !st!.joburi.some((x) => x.jobid === j.jobid))
  if (noi0.length) return { cod: 2, mesaj: `joburi Ofertare apărute după deschidere: ${noi0.map((j) => j.jobname).join(', ')} — neatinse`, stare: st }
  // un job țintă din snapshot găsit ACTIV (reactivat între rulări) → se oprește din nou ȘI așteptarea golirii o ia de la capăt
  let reoprit = false
  for (const j of (await db.joburi()).filter((x) => tinta(x) && st!.joburi.some((y) => y.jobid === x.jobid))) {
    if (j.active) { await db.seteazaActiv(j.jobid, false); reoprit = true }
  }
  if (reoprit && st.t_joburi_oprite !== null) { st.t_joburi_oprite = null; st.t_stop = null; st.t_gol = null; await salveaza(st) }
  const dupa = await db.joburi()
  const active = dupa.filter((j) => tinta(j) && j.active)
  if (active.length) return { cod: 2, mesaj: `joburi încă active: ${active.map((j) => j.jobname).join(', ')}`, stare: st }
  if (st.t_joburi_oprite === null) { st.t_joburi_oprite = db.acum(); await salveaza(st) }
  // ORICE activitate observată (rulare cron în curs, heartbeat NAS după oprire, coadă ocupată) invalidează golirea: ea se
  // reia de la zero abia după ce activitatea dispare — liniștea se dovedește pe interval, nu prin verificarea punctuală
  const invalideaza = async () => { if (st!.t_stop !== null || st!.t_gol !== null) { st!.t_stop = null; st!.t_gol = null; await salveaza(st!) } }
  const inCurs = await db.inCurs(dupa.filter(tinta).map((j) => j.jobid))
  if (inCurs > 0) { await invalideaza(); return { cod: 5, mesaj: `${inCurs} rulări cron Ofertare încă în curs; golirea se reia după ele`, stare: st } }
  const veghe = await db.vegheUltimaRulare()
  if (veghe !== null && db.acum() - veghe < DUPA_VEGHE_MS) return { cod: 5, mesaj: `veghea SEAP a rulat acum ${Math.round((db.acum() - veghe) / MIN)} min; reia după 30 min`, stare: st }
  for (const j of dupa.filter((x) => VEGHE.includes(x.jobname ?? ''))) {
    const p = ultimaProgramare((j as Job & { schedule?: string }).schedule ?? '', db.acum())
    if (p === null) return { cod: 2, mesaj: `orarul veghei ${j.jobname} nu e „m h * * *”; nu pot verifica distanța de 30 min`, stare: st }
    if (db.acum() - p < DUPA_VEGHE_MS) return { cod: 5, mesaj: `programarea ${j.jobname} a fost acum ${Math.round((db.acum() - p) / MIN)} min; reia după 30 min`, stare: st }
  }
  const hb = await db.heartbeat()
  if (hb !== null && st.t_stop !== null && hb > st.t_stop) await invalideaza()     // NAS a bătut DUPĂ oprire → golirea de la capăt
  if (hb !== null && db.acum() - hb < HEARTBEAT_OPRIT_MS) {
    return { cod: 5, mesaj: 'oprește worker-ul NAS (ofertare-worker); heartbeat-ul trebuie să fie mai vechi de 10 min', stare: st }
  }
  if (st.t_stop === null) { st.t_stop = Math.max(st.t_joburi_oprite, hb ?? 0); await salveaza(st) }
  const coada = await db.coada()
  if (coada > 0) { if (st.t_gol !== null) { st.t_gol = null; await salveaza(st) } return { cod: 5, mesaj: `coada pg_net are ${coada} cereri; golirea se reia după ea`, stare: st } }
  if (st.t_gol === null) { st.t_gol = db.acum(); await salveaza(st) }
  const ramas = st.t_gol + GOLIRE_MS - db.acum()
  if (ramas > 0) return { cod: 5, mesaj: `golire: mai sunt ${Math.ceil(ramas / MIN)} min (T_gol + 15 min)`, stare: st }
  if ((await db.coada()) > 0) { st.t_gol = null; await salveaza(st); return { cod: 5, mesaj: 'coada pg_net nu mai e goală; golirea se reia', stare: st } }
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

// validarea completă a stării: câmpurile există (nu doar „acceptă undefined”), timpii sunt null sau numere finite, iar cei
// nenuli respectă creat_la ≤ t_joburi_oprite ≤ t_stop ≤ t_gol — altfel un t_gol lipsă / invalid ar sări peste cele 15 minute
export function stareValida(st: StareF): string | null {
  if (!st || typeof st !== 'object') return 'nu e obiect'
  for (const k of ['run_id', 'stare', 'creat_la', 'joburi', 'nas_pornit', 't_joburi_oprite', 't_stop', 't_gol']) if (!(k in st)) return `lipsește ${k}`
  if (typeof st.run_id !== 'string' || !st.run_id) return 'run_id'
  if (!['OPEN', 'CLOSED'].includes(st.stare)) return 'stare'
  if (!(typeof st.creat_la === 'number' && Number.isFinite(st.creat_la))) return 'creat_la'
  if (typeof st.nas_pornit !== 'boolean') return 'nas_pornit'
  if (!Array.isArray(st.joburi) || st.joburi.some((j) => !Number.isInteger(j?.jobid) || typeof j.active !== 'boolean')) return 'joburi'
  const timp = (x: unknown) => x === null || (typeof x === 'number' && Number.isFinite(x))
  if (!timp(st.t_joburi_oprite) || !timp(st.t_stop) || !timp(st.t_gol)) return 't_joburi_oprite / t_stop / t_gol nu sunt null sau număr finit'
  // etapele sunt cumulative: t_gol cere t_stop, t_stop cere t_joburi_oprite (o etapă lipsă nu poate fi sărită)
  if (st.t_gol !== null && st.t_stop === null) return 't_gol fără t_stop'
  if (st.t_stop !== null && st.t_joburi_oprite === null) return 't_stop fără t_joburi_oprite'
  const lant = [st.creat_la, st.t_joburi_oprite, st.t_stop, st.t_gol].filter((x): x is number => x !== null)
  if (lant.some((x, i) => i > 0 && x < lant[i - 1])) return 'ordinea timpilor (creat_la ≤ t_joburi_oprite ≤ t_stop ≤ t_gol)'
  return null
}

// starea ferestrei: DOAR absența fișierului permite o stare nouă; ilizibil / corupt / formă invalidă → eroare (fără suprascriere)
export async function incarcaStare(fis: string): Promise<{ st: StareF | null } | { eroare: string }> {
  let txt: string
  try { txt = await Deno.readTextFile(fis) } catch (e) {
    if (e instanceof Deno.errors.NotFound) return { st: null }
    return { eroare: `stare ilizibilă (${String(e).slice(0, 120)})` }
  }
  try {
    const st = JSON.parse(txt) as StareF
    const v = stareValida(st)
    return v ? { eroare: `stare invalidă: ${v}` } : { st }
  } catch { return { eroare: 'stare coruptă (JSON invalid)' } }
}

if (import.meta.main) {
  const [cmd, dir] = Deno.args
  if (!['deschide', 'inchide'].includes(cmd) || !dir) { console.error('utilizare: fereastra.ts deschide|inchide <dir>'); Deno.exit(2) }
  const url = Deno.env.get('RV1_PG_URL'); if (!url) { console.error('lipsește RV1_PG_URL'); Deno.exit(2) }
  await Deno.mkdir(dir, { recursive: true })               // directorul ferestrei (<dir_val>/fereastra_N) se creează aici
  const { Client } = await import('https://deno.land/x/postgres@v0.19.3/mod.ts')
  let c: InstanceType<typeof Client>
  try { c = new Client(optiuniDeno(parseazaUrl(url), (await caSupabase()).pem)); await c.connect() } catch (e) {
    // fără fallback necriptat: orice eșec (URL, TLS, certificat, autentificare) → cod 2, fără să atingem nimic; mesaj FIX pe categorie
    console.error(`ATENȚIE [2] conexiunea postgres a eșuat: ${categorieEroare(e)}`)
    Deno.exit(2)
  }
  const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null)
  const db: Db = {
    joburi: async () => (await c.queryObject<Job>('SELECT jobid::int AS jobid, jobname, active, command, schedule FROM cron.job ORDER BY jobid')).rows,
    inCurs: async (ids) => Number((await c.queryArray(`SELECT count(*) FROM cron.job_run_details WHERE status = 'running' AND jobid = ANY($1)`, [ids])).rows[0][0]),
    seteazaActiv: async (id, a) => { await c.queryArray('SELECT cron.alter_job(job_id := $1, active := $2)', [id, a]) },
    coada: async () => Number((await c.queryArray(SQL_COADA_OFERTARE)).rows[0][0]),
    heartbeat: async () => ms((await c.queryArray('SELECT ultimul FROM public.worker_heartbeat WHERE nume = $1', [NAS])).rows[0]?.[0]),
    vegheUltimaRulare: async () => ms((await c.queryArray(
      `SELECT max(coalesce(d.end_time, d.start_time)) FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid WHERE j.jobname = ANY($1)`, [VEGHE])).rows[0]?.[0]),
    acum: () => Date.now(),
  }
  const fis = `${dir}/fereastra_stare.json`
  const inc = await incarcaStare(fis)
  if ('eroare' in inc) { await c.end(); console.error(`ATENȚIE [2] ${inc.eroare}: ${fis} — NU se suprascrie; decide chat-ul`); Deno.exit(2) }
  const st = inc.st
  const salveaza = async (s: StareF) => { await Deno.writeTextFile(fis + '.tmp', JSON.stringify(s, null, 1)); await Deno.rename(fis + '.tmp', fis) }
  const r = cmd === 'deschide' ? await deschide(db, st, salveaza) : await inchide(db, st, salveaza)
  await c.end()
  console.log(`${r.cod === 0 ? 'OK' : 'ATENȚIE'} [${r.cod}] ${r.mesaj}`)
  Deno.exit(r.cod)
}
