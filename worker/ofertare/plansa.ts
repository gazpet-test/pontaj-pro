// worker/ofertare/plansa.ts — R4 #142: citirea planșelor pe NAS, independentă de browser (27.09.2026).
// Consumă ofertare_plansa_coada (înscriere DOAR prin RPC-ul cu poarta pe cheltuială, owner/responsabil, în SQL) și rulează
// ACELAȘI handler ca edge function-ul (supabase/functions/ofertare-plansa-citeste/handler.ts), cu cheia service_role, în proces.
// Idempotența pe zonă rămâne cea din handler (rezervări per zonă + CAS pe citire_ai.rev + fuziune + versiune): un tab deschis
// și workerul cooperează fără plată dublă. Design: docs/R4_REZERVARE_ZONE_SI_COADA_NAS.md §3.
// Până la aplicarea migrării (GO Răzvan), RPC-ul lipsește și modulul nu face nimic (fără eroare în buclă).

export const LEASE_MIN = 10
export const PAUZA_ALT_TAB_MS = 60_000
export const MAX_PAUZE_ALT_TAB = 10
export const MAX_RUNDE = 25
export const TIMEOUT_AI_MS = 120_000
export const PARALEL = 4
export const PLAFON_IMPLICIT_USD = 10      // D1 Răzvan 27.09: 10 USD pe planșă (job)
export const PLAFON_ZI_USD = 40           // D1: 40 USD pe zi, pe toată coada (zi = calendarul Europe/Bucharest, vezi RPC)
// Rezervarea ÎNAINTE de apel = costul maxim plauzibil al unei runde: handler-ul citește cel mult FELII_PE_RULARE=4 zone pe rundă,
// iar cel mai scump apel pe zonă măsurat în ai_usage_log (124 apeluri plansa, 27.09.2026) = 0,71 USD → 4 × 0,75 = 3 USD.
export const REZERVA_RUNDA_USD = 3
export const REZERVA_LIPIRE_USD = 1

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[plansa]', ...a)

// Pasul 3 din design: modul se alege pe starea PROASPĂTĂ a documentului, la fiecare rundă. „citește” de la zero (de_la:0,
// resetare în handler) DOAR dacă jobul e „citeste” și nu există nicio citire pe tăierea jobului; altfel continua/reia_erori.
export function corpRunda(job: any, doc: any, o: { deLa?: number | null; sari?: string[] } = {}): Record<string, unknown> {
  const ca = doc?.analiza?.citire_ai
  const citirePeTaiere = !!ca && (ca.taiat_la ?? null) === (job.taiat_la ?? null)
  if (job.mod === 'reia_erori') return { doc_id: job.doc_id, mod: 'reia_erori', sari: o.sari ?? [], paralel: PARALEL }
  if (job.mod === 'citeste' && !citirePeTaiere) return { doc_id: job.doc_id, de_la: 0, paralel: PARALEL }
  if (job.mod === 'citeste' && o.deLa != null && o.deLa > 0) return { doc_id: job.doc_id, de_la: o.deLa, paralel: PARALEL }
  return { doc_id: job.doc_id, mod: 'continua', paralel: PARALEL }
}

// Pasul 2: proveniența înghețată la înscriere trebuie să corespundă documentului de acum.
export function motivAnulare(job: any, doc: any, hashuri: string[] = []): string | null {
  if (!doc) return 'documentul nu mai există'
  if (job.licitatie_id != null && Number(doc.licitatie_id) !== Number(job.licitatie_id)) return 'documentul a fost mutat pe altă licitație după înscriere'
  if (job.fisier_path && doc.fisier_path !== job.fisier_path) return 'fișierul s-a schimbat după înscriere'
  const valide = hashuri.filter(h => typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h))
  if (job.doc_sha256 != null && valide.length && !valide.some(h => h.toLowerCase() === job.doc_sha256.toLowerCase())) return 'fișierul s-a schimbat după înscriere'
  const p = doc.analiza?.plansa || {}
  if ((p.taiat_la ?? null) !== (job.taiat_la ?? null)) return 'planșa a fost retăiată după înscriere — reînscrie'
  if ((p.cale_felii ?? null) !== (job.cale_felii ?? null)) return 'feliile planșei s-au schimbat după înscriere — reînscrie'
  if (p.citibila === false) return 'planșa e marcată necitibilă'
  return null
}

// Pasul 6: clasificarea răspunsului handler-ului.
export type Clasa = 'ok' | 'alt_tab' | 'anulat' | 'furnizor' | 'business'
// Copilot #494: un 200 fără contract (JSON invalid, {error}, fără „continua” boolean) NU e succes.
export function clasifica(status: number, body: any): Clasa | 'invalid' {
  if (status === 200) return body && typeof body === 'object' && !body.error && typeof body.continua === 'boolean' ? 'ok' : 'invalid'
  if (status === 409) return Array.isArray(body?.in_lucru) ? 'alt_tab' : 'anulat'
  if (status >= 500 || status === 429) return 'furnizor'
  return 'business'
}

export const backoffMin = (incercari: number) => Math.min(60, 2 ** Math.max(1, incercari))

// „gata” DOAR dacă handler-ul a spus explicit că a terminat, sumarul există, fără erori, iar lipirea necesară a reușit.
export function stareFinala(sumar: any, o: { terminat?: boolean; lipireOk?: boolean } = {}): 'gata' | 'partial' {
  if (!o.terminat || !sumar || o.lipireOk === false) return 'partial'
  return Number(sumar?.erori || 0) > 0 ? 'partial' : 'gata'
}

export type DepsPlansa = {
  supabase: any
  handler: (req: Request, deps: any) => Promise<Response>
  depsHandler: any                 // { SERVICE, API_KEY, supa, fetch, getUser }
  worker: string
  sleep?: (ms: number) => Promise<void>
  stare?: (s: string) => void
  oprire?: () => boolean
  plafonZiUsd?: number
}

const sleepImplicit = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

// fetch cu timeout pe AI (pasul 4): în worker nu mai e ceasul Edge care să termine runda înaintea rezervării de 7 min.
export const fetchCuTimeout = (f: typeof fetch = fetch, ms = TIMEOUT_AI_MS): typeof fetch =>
  ((u: any, init: any = {}) => {
    // Copilot #494: signal-ul apelantului NU înlocuiește timeoutul — se compun (oricare anulează).
    const t = AbortSignal.timeout(ms)
    return f(u, { ...init, signal: init.signal ? AbortSignal.any([init.signal, t]) : t })
  }) as typeof fetch

// Ia un job și îl duce la capăt. Întoarce false când nu e nimic de luat (sau coada nu există încă).
export async function proceseazaPlansa(d: DepsPlansa): Promise<boolean> {
  const { supabase, worker } = d
  const sleep = d.sleep ?? sleepImplicit, stare = d.stare ?? (() => {}), oprire = d.oprire ?? (() => false)
  const { data: joburi, error: eIa } = await supabase.rpc('ofertare_plansa_coada_ia', { p_worker: worker, p_lease_min: LEASE_MIN })
  if (eIa) {
    // PGRST202 / 42883 = funcția nu există (migrarea neaplicată): tăcere, nu zgomot în log la fiecare tură.
    if (!/PGRST202|42883|does not exist|Could not find the function/i.test(`${eIa.code} ${eIa.message}`)) log('claim:', eIa.message)
    return false
  }
  const job = Array.isArray(joburi) ? joburi[0] : joburi
  if (!job?.id) return false

  let cost = Number(job.cost_usd || 0), runde = Number(job.runde || 0)
  const jurnal: any[] = Array.isArray(job.jurnal) ? [...job.jurnal] : []
  // UPDATE condiționat pe preluarea CURENTĂ (claim_token unic per claim, nu numele workerului): o execuție veche care revine
  // după ce jobul a fost preluat din nou (chiar de o instanță cu același nume) scrie 0 rânduri => se oprește fără alt apel AI.
  const scrie = async (patch: Record<string, unknown>): Promise<boolean> => {
    const { data, error } = await supabase.from('ofertare_plansa_coada').update(patch)
      .eq('id', job.id).eq('claim_token', job.claim_token).eq('stare', 'lucru').select('id')
    if (error) { log(`job ${job.id}: scriere eșuată:`, error.message); return false }
    return Array.isArray(data) && data.length === 1
  }
  const incheie = async (st: string, extra: Record<string, unknown> = {}) => {
    const final = st !== 'asteapta'
    const ok = await scrie({ stare: st, ...(final ? { terminat_la: new Date().toISOString() } : {}), runde, jurnal, ...extra })
    if (ok && job.cerut_de && st !== 'asteapta') {
      const titlu = st === 'gata' ? 'citirea planșei s-a terminat' : st === 'partial' ? 'planșa e citită parțial (zone căzute)'
        : st === 'oprit_plafon' ? 'citirea planșei s-a oprit la plafonul de cost' : `citirea planșei: ${st}`
      await supabase.from('notifications').insert({
        profile_id: job.cerut_de, type: st === 'gata' ? 'info' : 'warning', modul: 'Ofertare',
        title: `Ofertare: ${titlu} (doc ${job.doc_id})`,
        message: String(extra.motiv_anulare ?? extra.eroare ?? `${runde} runde · ${cost.toFixed(2)} USD (worker NAS)`).slice(0, 900),
        link_to: '/ofertare',
      })
    }
    return ok
  }

  let hashuri: string[] = []
  const citesteDoc = async () => {
    const { data, error } = await supabase.from('ofertare_documente_atribuire')
      .select('id, licitatie_id, fisier_path, analiza').eq('id', job.doc_id).maybeSingle()
    if (error) throw new Error(`documentul nu poate fi verificat: ${error.message}`)
    hashuri = []
    if (job.doc_sha256 != null) {
      const { data: manifest, error: em } = await supabase.from('ofertare_seap_manifest')
        .select('sha256').eq('document_id', job.doc_id).eq('stare', 'deja_in_platforma')
      if (em) throw new Error(`identitatea nu poate fi verificată: ${em.message}`)
      hashuri = (manifest ?? []).map((m: any) => m.sha256).filter((h: any) => typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h))
    }
    if (!hashuri.length) jurnal.push({ la: new Date().toISOString(), identitate: 'neverificata' })
    return data
  }

  // Rezervarea și ambele plafoane se verifică atomic în SQL. Registrul este singura sursă pentru costul cozii.
  let rezervareId: number | null = null
  const bugetOk = async (rezerva: number): Promise<string | null> => {
    const { data, error } = await supabase.rpc('ofertare_plansa_rezerva', {
      p_job_id: job.id, p_claim_token: job.claim_token, p_suma: rezerva, p_plafon_zi: d.plafonZiUsd ?? PLAFON_ZI_USD,
    })
    if (error) return `bugetul nu se poate rezerva (${error.message}) — nu pornesc apeluri AI`
    if (data?.ok !== true || data.rezervare_id == null) return data?.motiv ?? 'răspuns invalid la rezervarea bugetului'
    rezervareId = data.rezervare_id
    cost += rezerva // afișare conservatoare și dacă regularizarea nu mai răspunde; coada o actualizează numai SQL-ul
    return null
  }
  const regularizeaza = async (raspuns: any): Promise<boolean> => {
    const cert = typeof raspuns?.cost_usd === 'number' && Number.isFinite(raspuns.cost_usd) && raspuns.cost_usd >= 0
    const { data, error } = await supabase.rpc('ofertare_plansa_regularizeaza', {
      p_rezervare_id: rezervareId, p_claim_token: job.claim_token, p_cost: cert ? raspuns.cost_usd : null, p_cert: cert,
    })
    if (error || data?.ok !== true || typeof data.cost_usd !== 'number' || !Number.isFinite(data.cost_usd)) {
      // Nu mai apelăm AI: rezervarea rămasă în registru continuă să blocheze suma și la retry.
      log(`job ${job.id}: regularizare eșuată`, error?.message ?? data?.motiv ?? 'răspuns invalid')
      return false
    }
    cost = data.cost_usd
    return true
  }
  const opresteLaBuget = async (motiv: string) => {
    if (motiv === 'lease') { log(`job ${job.id}: lease pierdut — mă opresc`); return true }
    await incheie('oprit_plafon', { eroare: motiv }); return true
  }

  try {
    let doc = await citesteDoc()
    const m0 = motivAnulare(job, doc, hashuri)
    if (m0) { await incheie('anulat', { motiv_anulare: m0 }); log(`job ${job.id}: anulat — ${m0}`); return true }

    let deLa: number | null = null, sari: string[] = [], pauzeAltTab = 0, ultimSumar: any = null, lipire = 0, terminat = false
    while (!oprire() && runde < MAX_RUNDE) {
      // Identitatea sursei se reverifică înaintea FIECĂRUI apel (inclusiv după pauza 409): retăiere / mutare = anulat, zero AI.
      const m = motivAnulare(job, doc, hashuri)
      if (m) { await incheie('anulat', { motiv_anulare: m }); return true }
      const mb = await bugetOk(REZERVA_RUNDA_USD)
      if (mb) return await opresteLaBuget(mb)
      const body = corpRunda(job, doc, { deLa, sari })
      stare(`doc ${job.doc_id} · runda ${runde + 1} · ${body.mod ?? 'de_la ' + body.de_la}`)
      const t0 = Date.now()
      let status = 0, raspuns: any = {}
      try {
        const req = new Request('http://worker/ofertare-plansa-citeste', {
          method: 'POST', body: JSON.stringify(body),
          headers: { Authorization: `Bearer ${d.depsHandler.SERVICE}`, 'Content-Type': 'application/json' },
        })
        const res = await d.handler(req, d.depsHandler)
        status = res.status
        raspuns = await res.json().catch(() => ({}))
      } catch (e) { status = 599; raspuns = { error: 'excepție: ' + String((e as Error)?.message ?? e) } }
      const ms = Date.now() - t0
      const cert = typeof raspuns?.cost_usd === 'number' && Number.isFinite(raspuns.cost_usd) && raspuns.cost_usd >= 0
      const c = cert ? raspuns.cost_usd : REZERVA_RUNDA_USD
      const cls = clasifica(status, raspuns)
      jurnal.push({ la: new Date().toISOString(), body, status, clasa: cls, citite_acum: raspuns?.citite_acum ?? 0,
        in_lucru_alt_tab: raspuns?.in_lucru_alt_tab ?? raspuns?.in_lucru ?? undefined, cost_usd: c, cost_cert: cert, ms,
        eroare: raspuns?.error ? String(raspuns.error).slice(0, 300) : undefined })
      if (!(await regularizeaza(raspuns))) {
        await incheie('eroare', { eroare: 'regularizarea costului a eșuat — rezervarea rămâne în buget' }); return true
      }

      if (cls === 'alt_tab') {
        pauzeAltTab++
        if (!(await scrie({ lease_pana: new Date(Date.now() + LEASE_MIN * 60_000).toISOString(), jurnal }))) return true
        if (pauzeAltTab > MAX_PAUZE_ALT_TAB) {
          await incheie('asteapta', { urmatoarea_la: new Date(Date.now() + backoffMin(job.incercari) * 60_000).toISOString(),
            luat_de: null, lease_pana: null, eroare: 'altă rulare ține zonele de prea mult timp — reiau mai târziu' })
          return true
        }
        await sleep(PAUZA_ALT_TAB_MS); doc = await citesteDoc(); continue
      }
      if (cls === 'anulat') { await incheie('anulat', { motiv_anulare: String(raspuns?.error ?? 'conflict').slice(0, 500) }); return true }
      if (cls === 'furnizor') {
        if (Number(job.incercari || 0) >= Number(job.max_incercari || 3)) {
          await incheie('eroare', { eroare: `furnizor: ${String(raspuns?.error ?? 'HTTP ' + status).slice(0, 400)} (după ${job.incercari} încercări)` })
          return true
        }
        await incheie('asteapta', { urmatoarea_la: new Date(Date.now() + backoffMin(job.incercari) * 60_000).toISOString(),
          luat_de: null, lease_pana: null, eroare: String(raspuns?.error ?? `HTTP ${status}`).slice(0, 500) })
        log(`job ${job.id}: eroare de furnizor (${status}) — reiau cu backoff`)
        return true
      }
      if (cls === 'invalid') {
        await incheie('eroare', { eroare: `răspuns invalid de la handler (HTTP ${status}): ${String(raspuns?.error ?? 'fără „continua”').slice(0, 400)}` })
        return true
      }
      if (cls === 'business') { await incheie('eroare', { eroare: String(raspuns?.error ?? `HTTP ${status}`).slice(0, 500) }); return true }

      runde++
      ultimSumar = raspuns?.sumar ?? ultimSumar
      sari = Array.isArray(raspuns?.reincercate) ? raspuns.reincercate : sari
      deLa = raspuns?.de_la_urmator ?? null
      if (!(await scrie({ runde, jurnal, lease_pana: new Date(Date.now() + LEASE_MIN * 60_000).toISOString() }))) {
        log(`job ${job.id}: lease pierdut — mă opresc`); return true
      }
      if (!raspuns.continua) { lipire = Number(raspuns?.lipire_necesara || 0); terminat = true; break }
      doc = await citesteDoc()
    }
    if (oprire()) {   // SIGTERM: lăsăm jobul să fie reluat (lease-ul expiră), fără să-l închidem greșit
      await scrie({ stare: 'asteapta', luat_de: null, lease_pana: null, claim_token: null, jurnal, runde }); return true
    }
    let lipireOk: boolean | undefined
    if (lipire > 0) {
      lipireOk = false
      doc = await citesteDoc()
      const m = motivAnulare(job, doc, hashuri)
      if (m) { await incheie('anulat', { motiv_anulare: m }); return true }
      const mb = await bugetOk(REZERVA_LIPIRE_USD)
      if (mb) return await opresteLaBuget(mb)
      let status = 0, r: any = {}
      try {
        const req = new Request('http://worker/ofertare-plansa-citeste', { method: 'POST', body: JSON.stringify({ doc_id: job.doc_id, doar_lipire: true }),
          headers: { Authorization: `Bearer ${d.depsHandler.SERVICE}`, 'Content-Type': 'application/json' } })
        const res = await d.handler(req, d.depsHandler)
        status = res.status
        r = await res.json().catch(() => ({}))
        lipireOk = status === 200 && typeof r?.perechi === 'number' && !r?.error
      } catch (e) { status = 599; r = { error: String((e as Error)?.message ?? e).slice(0, 200) } }
      const cert = typeof r?.cost_usd === 'number' && Number.isFinite(r.cost_usd) && r.cost_usd >= 0
      jurnal.push({ la: new Date().toISOString(), body: { doar_lipire: true }, status,
        cost_usd: cert ? r.cost_usd : REZERVA_LIPIRE_USD, cost_cert: cert,
        eroare: r?.error ? String(r.error).slice(0, 300) : undefined })
      if (!(await regularizeaza(r))) lipireOk = false
    }
    // MAX_RUNDE atins cu „continua” = citire neterminată → partial, cu motiv; niciodată „gata”.
    const st = !terminat && !ultimSumar ? 'eroare' : stareFinala(ultimSumar, { terminat, lipireOk })
    const motiv = !terminat ? `oprit după ${MAX_RUNDE} runde, citirea nu s-a terminat — pornește „continuă”`
      : lipireOk === false ? 'lipirea notelor tăiate a eșuat — reia „lipește”' : undefined
    await incheie(st, { ...(motiv ? { eroare: motiv } : {}), rezultat: ultimSumar ? { felii_citite: ultimSumar.felii_citite, erori: ultimSumar.erori, zone_cazute: ultimSumar.zone_cazute,
      tronsoane: ultimSumar.tronsoane_gasite, lungime_m: ultimSumar.lungime_totala_m } : null })
    log(`job ${job.id} (doc ${job.doc_id}): ${st} · ${runde} runde · ${cost.toFixed(2)} USD`)
    return true
  } catch (e) {
    await incheie('eroare', { eroare: String((e as Error)?.message ?? e).slice(0, 500) })
    return true
  }
}
