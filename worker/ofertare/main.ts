// worker/ofertare/main.ts — workerul de extragere a cerințelor, rulat pe NAS Terra (container Docker, 22.09.2026).
// Ia lucrul din ofertare_extragere_coada (aceeași coadă pe care o consumă și pg_cron-ul ofertare_extragere_tick)
// și rulează ACELAȘI cod ca edge function-ul (supabase/functions/ofertare-cerinte/core.ts), dar fără limita de
// 150 s a gateway-ului Supabase: felii mai mari, răspunsuri lungi, reîncercări cu pauză.
// Heartbeat în worker_heartbeat: cât e proaspăt (< 10 min), tick-ul din Supabase nu lansează nimic; dacă workerul
// cade, tick-ul reia singur (failover). Doar conexiuni de IEȘIRE (Supabase + Anthropic); nimic nu intră spre NAS.
// Deploy: entrypoint.sh face git pull din repo și repornește procesul când apare un commit nou pe ramură.
// 22.09.2026 seara: consumă și ofertare_ingest_coada (citirea documentelor) — vezi ingest.ts: text gratuit cu pdftotext
// pentru PDF-urile cu strat de text, AI (edge function) doar pentru scanuri.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import { extrageCerinte } from '../../supabase/functions/ofertare-cerinte/core.ts'
import { proceseazaIngest } from './ingest.ts'
import { proceseazaAcoperire } from './acoperire.ts'
import { proceseazaClarificari } from './clarificari.ts'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const SUPABASE_URL = env('SUPABASE_URL'), SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY')
if (!SUPABASE_URL || !SERVICE_KEY || !env('ANTHROPIC_API_KEY')) {
  console.error('[worker] lipsesc SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY (vezi .env.example)')
  Deno.exit(1)
}
const NUME = env('WORKER_NUME', 'ofertare-worker')
const PARALEL = Math.max(1, Number(env('WORKER_PARALEL', '2')) || 2)          // licitații lucrate simultan
const BUCATA_MAX = Math.max(6_000, Number(env('WORKER_BUCATA_MAX', '20000')) || 20_000)  // caractere per apel AI
const SHA = env('WORKER_GIT_SHA', '?'), BRANCH = env('REPO_BRANCH', 'main')
// Decizie Răzvan 22.09.2026 („2"): documentele din corpus (caiete, memorii, PT, formulare) se citesc cu Sonnet (5x mai ieftin);
// fișa de date și clarificările rămân pe modelul cozii (Opus implicit), cum a recomandat și Jakarinos.
const MODEL_CORPUS = env('WORKER_MODEL_CORPUS', 'claude-sonnet-5')
const TIPURI_OPUS = new Set(['clarificare', 'raspuns_clarificare'])
const PAUZA_MS = 15_000, HEARTBEAT_MS = 30_000, VERIFICA_GIT_MS = 5 * 60_000
const MAX_INCERCARI = 3, LEASE_TICK_MS = 4 * 60_000

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const inLucru = new Map<number, string>()   // licitatie_id → ce face acum (apare în heartbeat)
let oprire = false
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), ...a)

async function heartbeat(extra: Record<string, unknown> = {}) {
  const detalii = { sha: SHA, branch: BRANCH, paralel: PARALEL, bucata_max: BUCATA_MAX, in_lucru: [...inLucru.entries()].map(([id, ce]) => `#${id}: ${ce}`), ...extra }
  const { error } = await supabase.from('worker_heartbeat').upsert({ nume: NUME, ultimul: new Date().toISOString(), detalii })
  if (error) log('heartbeat eroare:', error.message)
}

async function proceseazaLicitatie(id: number) {
  inLucru.set(id, 'start')
  let incercari = 0
  try {
    while (!oprire) {
      const { data: c, error } = await supabase.from('ofertare_extragere_coada').select('*').eq('licitatie_id', id).maybeSingle()
      if (error || !c) { log(`#${id}: rândul din coadă nu se mai citește`, error?.message ?? ''); return }
      if (!c.activ) return
      // un apel lansat de tick-ul din Supabase (înainte să pornim noi) încă în zbor? îl lăsăm până expiră lease-ul
      if (c.req_id != null) {
        const vechime = Date.now() - new Date(c.lansat_la ?? 0).getTime()
        if (vechime < LEASE_TICK_MS) { inLucru.set(id, 'aștept apelul lansat de tick'); await sleep(30_000); continue }
        await supabase.from('ofertare_extragere_coada').update({ req_id: null }).eq('licitatie_id', id)
      }
      const pasi: any[] = Array.isArray(c.pasi) ? c.pasi : []
      if (c.poz >= pasi.length) {
        const acum = new Date().toISOString()
        const nota = `${pasi.length} pași, ${c.cerinte_noi} cerințe noi, ${c.erori} pași cu eroare (worker NAS ${SHA})`
        await supabase.from('ofertare_extragere_coada').update({ activ: false, terminat_la: acum, nota, ultimul_tick: acum }).eq('licitatie_id', id)
        if (c.cerut_de) {
          const { data: li } = await supabase.from('ofertare_licitatii').select('id, nr_anunt').eq('id', id).maybeSingle()
          const { error: eN } = await supabase.from('notifications').insert({
            profile_id: c.cerut_de, type: 'info', modul: 'Ofertare',
            title: `Ofertare: extragerea cerințelor s-a terminat la ${li?.nr_anunt ?? '#' + id}`,
            message: `${nota}. Confirmă registrul și rulează „Propune acoperire".`, link_to: '/ofertare',
          })
          if (eN) log(`#${id}: notificarea nu s-a putut scrie:`, eN.message)
        }
        log(`#${id}: GATA — ${nota}`)
        return
      }
      const pas = pasi[c.poz] ?? {}
      const body: Record<string, unknown> = { licitatie_id: id, bucata: c.bucata, bucata_max: BUCATA_MAX, model: c.model || 'claude-opus-5' }
      if (pas.doc_id != null) {
        body.doc_id = Number(pas.doc_id)
        const { data: dd } = await supabase.from('ofertare_documente_atribuire').select('tip').eq('id', Number(pas.doc_id)).maybeSingle()
        if (!TIPURI_OPUS.has(String(dd?.tip ?? ''))) body.model = MODEL_CORPUS
      }
      else { body.sectiune = pas.sectiune; if (pas.reset === true && c.bucata === 0) body.reset = true }
      const eticheta = pas.doc_id != null ? `doc ${pas.doc_id}` : `secțiunea ${pas.sectiune}`
      inLucru.set(id, `${eticheta} · bucata ${c.bucata + 1} (pas ${c.poz + 1}/${pasi.length})`)
      const t0 = Date.now()
      let r: any
      try { r = await extrageCerinte(supabase, body) } catch (e) { r = { error: 'excepție: ' + String((e as Error)?.message ?? e) } }
      const ms = Date.now() - t0, acum = new Date().toISOString()
      if (!r || r.error) {
        incercari++
        const msg = String(r?.error ?? 'răspuns gol')
        log(`#${id}: ${eticheta} bucata ${c.bucata + 1} EROARE ${incercari}/${MAX_INCERCARI} (${ms} ms): ${msg}`)
        if (incercari >= MAX_INCERCARI) {
          await supabase.from('ofertare_extragere_coada').update({
            erori: c.erori + 1, poz: c.poz + 1, bucata: 0, incercari: 0, ultimul_tick: acum,
            jurnal: [...(c.jurnal ?? []), { poz: c.poz, bucata: c.bucata, eroare: msg.slice(0, 200), worker: NUME, la: acum }],
          }).eq('licitatie_id', id)
          incercari = 0
        } else {
          await supabase.from('ofertare_extragere_coada').update({ incercari, ultimul_tick: acum }).eq('licitatie_id', id)
          await sleep(20_000 * incercari)
        }
        continue
      }
      incercari = 0
      const cer = Number(r.cerinte) || 0, continua = r.continua === true
      const intrare: Record<string, unknown> = { poz: c.poz, bucata: c.bucata, cerinte: cer, bucati: r.bucati ?? null, ms, worker: NUME, la: acum }
      if (r.trunchiat === true) intrare.trunchiat = true
      if (r.skip) intrare.skip = r.skip
      await supabase.from('ofertare_extragere_coada').update({
        cerinte_noi: c.cerinte_noi + cer, bucata: continua ? (r.bucata_urmatoare ?? c.bucata + 1) : 0,
        poz: continua ? c.poz : c.poz + 1, incercari: 0, ultimul_tick: acum, jurnal: [...(c.jurnal ?? []), intrare],
      }).eq('licitatie_id', id)
      log(`#${id}: ${eticheta} bucata ${c.bucata + 1}/${r.bucati ?? '?'} [${String(body.model).replace('claude-', '')}] → ${cer} cerințe${r.trunchiat ? ' (TĂIAT la max_tokens!)' : ''}${r.skip ? ' · ' + r.skip : ''} · ${ms} ms · ${r.cost_usd ?? '?'} USD`)
    }
  } catch (e) {
    log(`#${id}: excepție neașteptată:`, (e as Error)?.message ?? e)
  } finally { inLucru.delete(id) }
}

async function comitNou(): Promise<boolean> {
  if (SHA === '?') return false
  try {
    await new Deno.Command('git', { args: ['-C', '/app', 'fetch', '-q', 'origin', BRANCH] }).output()
    const out = await new Deno.Command('git', { args: ['-C', '/app', 'rev-parse', '--short', 'FETCH_HEAD'] }).output()  // clona e single-branch: origin/<ramură> poate lipsi
    const remote = new TextDecoder().decode(out.stdout).trim()
    return !!remote && remote !== SHA
  } catch (e) { log('verificare git:', (e as Error)?.message ?? e); return false }
}

for (const s of ['SIGTERM', 'SIGINT'] as const) Deno.addSignalListener(s, () => { log(`${s} — termin felia curentă și ies`); oprire = true })
log(`[${NUME}] pornit · commit ${SHA} (${BRANCH}) · paralel ${PARALEL} · bucata_max ${BUCATA_MAX}`)
await heartbeat({ stare: 'pornit' })
let ultimHb = Date.now(), ultimGit = Date.now()
let ingestInLucru = false, acoperireInLucru = false, clarificariInLucru = false
while (!oprire) {
  try {
    if (inLucru.size < PARALEL) {
      const { data: rows, error } = await supabase.from('ofertare_extragere_coada').select('licitatie_id, cerut_la').eq('activ', true).order('cerut_la').limit(10)
      if (error) log('citire coadă:', error.message)
      for (const r of rows ?? []) {
        if (inLucru.size >= PARALEL) break
        if (!inLucru.has(r.licitatie_id)) { log(`#${r.licitatie_id}: preiau din coadă`); proceseazaLicitatie(r.licitatie_id) }
      }
    }
    if (!ingestInLucru) {
      const { data: ing } = await supabase.from('ofertare_ingest_coada').select('licitatie_id').eq('activ', true).order('cerut_la').limit(1)
      const lid = ing?.[0]?.licitatie_id
      if (lid) {
        ingestInLucru = true
        inLucru.set(-lid, 'citire documente')
        proceseazaIngest(supabase, lid, () => oprire, s => inLucru.set(-lid, `citire: ${s}`))
          .catch(e => log('ingest:', (e as Error)?.message ?? e))
          .finally(() => { inLucru.delete(-lid); ingestInLucru = false })
      }
    }
    if (!acoperireInLucru) {
      const { data: ac } = await supabase.from('ofertare_acoperire_coada').select('licitatie_id').eq('activ', true).order('cerut_la').limit(1)
      const lid = ac?.[0]?.licitatie_id
      if (lid) {
        acoperireInLucru = true
        inLucru.set(-1_000_000 - lid, 'acoperire')
        log(`#${lid}: propun acoperiri (coada)`)
        proceseazaAcoperire(supabase, lid, () => oprire, s => inLucru.set(-1_000_000 - lid, `acoperire: ${s}`))
          .catch(e => log('acoperire:', (e as Error)?.message ?? e))
          .finally(() => { inLucru.delete(-1_000_000 - lid); acoperireInLucru = false })
      }
    }
    if (!clarificariInLucru) {
      const { data: cl } = await supabase.from('ofertare_clarificari_coada').select('licitatie_id').eq('activ', true).order('cerut_la').limit(1)
      const lid = cl?.[0]?.licitatie_id
      if (lid) {
        clarificariInLucru = true
        inLucru.set(-2_000_000 - lid, 'clarificări')
        log(`#${lid}: propun clarificări (coada)`)
        proceseazaClarificari(supabase, lid, s => inLucru.set(-2_000_000 - lid, `clarificări: ${s}`))
          .catch(e => log('clarificari:', (e as Error)?.message ?? e))
          .finally(() => { inLucru.delete(-2_000_000 - lid); clarificariInLucru = false })
      }
    }
    if (Date.now() - ultimHb >= HEARTBEAT_MS) { await heartbeat(); ultimHb = Date.now() }
    if (inLucru.size === 0 && Date.now() - ultimGit >= VERIFICA_GIT_MS) {
      ultimGit = Date.now()
      if (await comitNou()) { log('commit nou pe origin — ies, entrypoint-ul pornește versiunea nouă'); break }
    }
  } catch (e) { log('bucla principală:', (e as Error)?.message ?? e) }
  await sleep(PAUZA_MS)
}
while (inLucru.size) await sleep(1000)
await heartbeat({ stare: 'oprit' })
Deno.exit(0)
