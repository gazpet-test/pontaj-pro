// worker/ofertare/ingest.ts — citirea documentelor pe NAS (22.09.2026, decizie Răzvan: „1 și 2").
// Consumă ofertare_ingest_coada (aceeași coadă ca butonul „☁ Pe server"). Pentru PDF-urile cu strat de text,
// textul se scoate GRATUIT cu pdftotext (poppler) și se scrie cu marcajele ⟦PAGINA n⟧ exact ca edge function-ul
// ofertare-ingest-doc; doar antetul (obiectiv/beneficiar/proiectant/revizie) se citește cu Haiku din primele pagini
// (~0,001 USD). Scanurile (fără strat de text) merg pe drumul vechi: edge function-ul ofertare-ingest-doc, cu AI.
// 26.09 (R6, doc 770): PDF-urile peste 60 MB (pe care edge-ul le refuză) se citesc aici, pe felii — vezi citire_mare.ts.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0'
import JSZip from 'https://esm.sh/jszip@3.10.1'
// .doc binar (OLE) — aceeași librărie ca edge-ul ofertare-word-text; esm.sh, NU npm: (npm: nu merge pe Terra)
import WordExtractor from 'https://esm.sh/word-extractor@1.0.4'  // fără ?target=deno: acolo fs e null și extract() pică (testat 25.09)
import { Buffer } from 'node:buffer'
// R6 (26.09): PDF-urile peste pragul edge-ului (60 MB, ex. 770 Huedin) — descărcare în flux + pdftotext pe felii
import { cuIncercare, cuTermen, gardaIncearca, incercareGarda, mesajEroare, metaObiect, opritDeGarda, sha256Hex, TERMEN_LOCAL_MS, type Incercare, type MetaObiect } from './garda.ts'   // GARDA (docs/INGEST_GARDA.md)
import { MAX_TEXT, MARCAJ_PREA_MARE, PRAG_MARE, citesteMare, compuneText, decizieCitireMare, esteMare, imparteText, mesajNecitite, trecereBlocata } from './citire_mare.ts'

const env = (k: string, d = '') => Deno.env.get(k) ?? d
const SUPABASE_URL = env('SUPABASE_URL'), SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY'), ANTHROPIC_KEY = env('ANTHROPIC_API_KEY')
// GARDA: edge-ul nu mai acceptă service_role „gol”; identitatea workerului e secretul dedicat (același în .env și în env-ul funcției)
const INGEST_SECRET = env('OFERTARE_INGEST_SECRET')
const BUCKET = 'ofertare'
const PRAG_TEXT_PAGINA = 120         // caractere non-spațiu ca o pagină să conteze „cu text"
const PRAG_DOC_TEXT = 0.85           // proporția de pagini cu text ca documentul să fie citit local
const HAIKU = { id: 'claude-haiku-4-5-20251001', in: 1 / 1e6, out: 5 / 1e6 }
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[ingest]', ...a)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// pauzele dintre reîncercări (ms) — obiect exportat ca testele să le poată pune pe 0.
// edgeNeclarMs (runda 3): după un răspuns NECLAR al edge-ului (vezi raspunsNeclar) — cel puțin limita de timp a unei
// invocări edge (400 s pe planul Pro; 504 vine la 150 s, deci invocarea mai poate trăi ≤250 s după el)
export const PAUZE = { edgeMs: 15_000, edgeNeclarMs: 400_000, reluareMareMs: 30_000, leaseReinnoireMs: 2 * 60_000, marcajTermenMs: 45_000 }
// runda 4: punct de injecție pentru teste (citirea pe felii simulată); producția folosește citesteMare din citire_mare.ts
export const _mare = { citesteMare }
// runda 4 (Copilot 1): rezultatul unui drum după care ownership-ul documentului e la gardă / la altă încercare — apelantul
// (proceseazaIngest) NU mai scrie NIMIC pe document, oricare ar fi rezultatul din aval
export const GESTIONAT = 'gestionat: '
// runda 3 (J2): termenul lucrului local sub lease (8 min < 10 min); obiect exportat ca testele să-l poată scurta
export const TERMENE = { lucruLocalMs: TERMEN_LOCAL_MS }
// dormitul din citesteCuAI, într-un obiect exportat: testele pun un ceas virtual (fără 400 s reale de așteptare)
export const ceas = { dormi: (ms: number): Promise<unknown> => sleep(ms) }

export type Supa = ReturnType<typeof createClient>

// runda 3 (J2): cu termen (ms) → procesul e oprit la termen și se aruncă „termen depășit” (nu „fără text”, care ar preda la AI)
async function ruleaza(cmd: string, args: string[], ms?: number): Promise<{ code: number; out: string; err: string }> {
  const semnal = ms != null ? AbortSignal.timeout(Math.max(1, ms)) : undefined
  const p = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped', ...(semnal ? { signal: semnal } : {}) }).output()
  if (semnal?.aborted) throw new Error(`termen depășit: ${cmd} (${Math.round((ms ?? 0) / 1000)} s)`)
  const dec = new TextDecoder()
  return { code: p.code, out: dec.decode(p.stdout), err: dec.decode(p.stderr) }
}

// textul pe pagini, din stratul de text al PDF-ului (pdftotext separă paginile cu \f)
async function textLocal(caleaPdf: string, termen = Infinity): Promise<{ pagini: string[]; nPag: number } | null> {
  const ramas = () => (termen === Infinity ? undefined : termen - Date.now())
  const info = await ruleaza('pdfinfo', [caleaPdf], ramas())
  const mPag = info.out.match(/^Pages:\s+(\d+)/m)
  const nPag = mPag ? Number(mPag[1]) : 0
  if (!nPag) return null
  const r = await ruleaza('pdftotext', ['-layout', '-enc', 'UTF-8', caleaPdf, '-'], ramas())
  if (r.code !== 0) { log('pdftotext:', r.err.slice(0, 200)); return null }
  // -layout păstrează coloanele tabelelor, dar umflă textul cu spații (fișa SEAP: ~4,6k car./pagină); rulăm 2+ spații
  // într-unul dublu — aceeași funcție ca pe felii (citire_mare.ts)
  return { pagini: imparteText(r.out, nPag), nPag }
}

async function antetDinText(text: string): Promise<{ antet: any; tokIn: number; tokOut: number }> {
  const prompt = `Primești începutul unui document dintr-o documentație de atribuire românească (licitație publică). Citește ANTETUL / pagina de gardă și răspunde EXCLUSIV cu JSON, fără altceva:
{"obiectiv": "...", "beneficiar": "...", "proiectant": "...", "proiect_nr": "...", "revizie": "...", "data": "..."}
Pune null unde nu apare. "revizie" = revizia/ediția documentului (ex. "Rev. 2", "R01"), nu data.

TEXT:
${text.slice(0, 6000)}`
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(env('ANTHROPIC_WORKSPACE_ID') ? { 'anthropic-workspace-id': env('ANTHROPIC_WORKSPACE_ID') } : {}) },
    body: JSON.stringify({ model: HAIKU.id, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error('antet Haiku: ' + (data.error?.message || resp.status))
  const txt = (data.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
  const m = txt.replace(/```json?|```/g, '').match(/\{[\s\S]*\}/)
  let antet: any = null
  try { antet = m ? JSON.parse(m[0]) : null } catch (_) { antet = null }
  return { antet, tokIn: data.usage?.input_tokens || 0, tokOut: data.usage?.output_tokens || 0 }
}

// R6/770 (runda 2, cauza reală a buclei): DOAR {ok:true} e succes — edge-ul pune ok:true pe toate răspunsurile bune
// (skip-uri + felie citită). Un răspuns de platformă fără `error` (546 WORKER_LIMIT {code,message} la „Memory limit
// exceeded”, 502/504 de la gateway, corp gol) era luat drept „gata (?/? pagini, AI)” → citite++ și documentul rămânea
// candidat: de aici cele 5421 de treceri pe 770. Întoarce motivul (null = succes); mesajul edge-ului rămâne neschimbat.
export function motivRaspunsEdge(data: any, http = 200): string | null {
  if (data && typeof data === 'object' && data.ok === true && !data.error) return null
  const h = http && http !== 200 ? ` (HTTP ${http})` : ''
  if (data?.error) return String(typeof data.error === 'object' ? (data.error.message ?? JSON.stringify(data.error)) : data.error) + h
  const parti = [data?.code, data?.message].filter(x => x != null && x !== '').map(String)
  return (parti.length ? parti.join(': ') : (data == null ? 'răspuns gol' : 'răspuns fără ok:true')) + h
}

// R6/770 (runda 3): răspuns NECLAR = edge-ul poate lucra ÎNCĂ pe felie. 504 = gateway-ul a tăiat la 150 s (request idle
// timeout), dar invocarea trăiește până la limita ei de timp (400 s pe Pro); 502/520/524 = proxy-ul n-a primit un verdict
// de la funcție; 0 = n-a venit niciun răspuns (apelul nostru a expirat la 170 s sau a căzut rețeaua). NU sunt neclare
// verdictele runtime-ului: 500 WORKER_ERROR, 503 BOOT_ERROR, 546 limită de resurse — invocarea s-a oprit.
// Dovada (25.09, doc 1276, din browser, 2 × 504): ai_usage_log scris la 12 s și 14 s DUPĂ 504, fără niciun 200 pereche,
// iar reîncercarea pornită la 5 s după primul 504, ÎNAINTE ca prima invocare să-și scrie felia, a citit-o din nou
// (rândurile 4500 și 4504) — cost AI dublu, „ultimul care scrie câștigă”. Vezi docs/R6_770_CITIRE_PDF_MARE.md §3.1.
export const raspunsNeclar = (http: number) => http === 0 || http === 502 || http === 504 || http === 520 || http === 524
export type ProgresDoc = { status_procesare: string | null; pagini: number | null; pagini_procesate: number | null }
const INCHEIAT = ['procesat', 'partial']
// a avansat documentul între două citiri din BD? (pagini_procesate mai mare, sau încheiat între timp)
// necunoscut (o citire a picat) → false: se numără ca încercare eșuată; siguranța vine din pauza lungă, nu de aici
export function aAvansat(inainte: ProgresDoc | null, dupa: ProgresDoc | null): boolean {
  if (!inainte || !dupa) return false
  if ((dupa.pagini_procesate ?? 0) > (inainte.pagini_procesate ?? 0)) return true
  return INCHEIAT.includes(String(dupa.status_procesare)) && !INCHEIAT.includes(String(inainte.status_procesare))
}
// runda 3: {apeluri:1} (o felie pe invocare, ca tick-ul din Supabase și cum cere edge-ul pentru apelurile de pe server:
// două felii de scan pot trece de 150 s) → 240 de runde = aceeași capacitate ca vechile 120 de runde × 2 felii
const RUNDE_AI = 240

// drumul vechi, cu AI (scanuri): edge function-ul ofertare-ingest-doc, apel după apel cât timp continua=true
export async function citesteCuAI(supabase: Supa, docId: number, esteOprire: () => boolean = () => false): Promise<string> {
  const progres = async (): Promise<ProgresDoc | null> => {
    try {
      const { data, error } = await supabase.from('ofertare_documente_atribuire').select('status_procesare, pagini, pagini_procesate').eq('id', docId).maybeSingle()
      return error ? null : (data as ProgresDoc | null)   // cast: tiparele supabase-js dau „never” (erori vechi)
    } catch (_) { return null }
  }
  let inainte = await progres()
  let incercari = 0
  for (let runda = 0; runda < RUNDE_AI; runda++) {
    // SIGTERM: ies doar ÎNTRE apeluri — apelul anterior s-a încheiat sau pauza lungă a trecut, deci nicio invocare edge
    // nu mai lucrează pe document; felia scrisă rămâne, iar următoarea tură reia de la pagini_procesate
    if (runda > 0 && esteOprire()) return `întrerupt: SIGTERM (${inainte?.pagini_procesate ?? '?'}/${inainte?.pagini ?? '?'} pagini, AI; se reia de acolo)`
    let data: any, http = 0
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/ofertare-ingest-doc`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'x-ingest-secret': INGEST_SECRET, 'content-type': 'application/json' },
        body: JSON.stringify({ doc_id: docId, apeluri: 1 }),
        signal: AbortSignal.timeout(170_000),
      })
      http = resp.status
      const corp = await resp.text()
      try { data = corp ? JSON.parse(corp) : null } catch (_) { data = { error: 'răspuns ne-JSON: ' + corp.slice(0, 120).replace(/\s+/g, ' ').trim() } }
    } catch (e) { data = { error: 'apel edge: ' + String((e as Error)?.message ?? e) } }
    // GARDA: blocat / backoff / deja citit — răspuns definitiv pentru tura asta, fără reîncercare
    if (data?.garda) return `garda: ${data.garda} — ${data.error ?? ''}`
    const motiv = motivRaspunsEdge(data, http)
    if (motiv && raspunsNeclar(http)) {
      // NU reîncerc cât invocarea poate trăi: aștept peste limita ei, apoi văd în BD dacă și-a scris felia.
      // Pauza nu se scurtează la SIGTERM (170 s apel + 400 s < stop_grace_period 12 min).
      log(`doc ${docId}: ${motiv} — edge-ul poate lucra încă; aștept ${Math.round(PAUZE.edgeNeclarMs / 1000)} s, apoi verific pagini_procesate`)
      await ceas.dormi(PAUZE.edgeNeclarMs)
      const dupa = await progres()
      if (aAvansat(inainte, dupa)) {
        log(`doc ${docId}: edge-ul și-a terminat felia după ${motiv} (${inainte?.pagini_procesate ?? '?'} → ${dupa!.pagini_procesate ?? '?'} pagini)`)
        inainte = dupa; incercari = 0
        if (INCHEIAT.includes(String(dupa!.status_procesare))) return `${dupa!.status_procesare} (${dupa!.pagini_procesate ?? '?'}/${dupa!.pagini ?? '?'} pagini, AI; încheiat de edge după ${motiv})`
        continue
      }
      if (dupa) inainte = dupa
      if (++incercari >= 3) return 'eroare: ' + motiv
      continue   // pauza lungă e deja făcută
    }
    if (motiv) {
      if (++incercari >= 3) return 'eroare: ' + motiv
      await ceas.dormi(PAUZE.edgeMs * incercari); continue
    }
    incercari = 0
    if (data.skip) return 'sărit: ' + data.skip
    if (!data.continua) return `${data.status ?? 'gata'} (${data.pagini_procesate ?? '?'}/${data.pagini ?? '?'} pagini, AI)`
    inainte = { status_procesare: data.status ?? null, pagini: data.pagini ?? null, pagini_procesate: data.pagini_procesate ?? null }
  }
  return 'eroare: prea multe runde'
}

// R6: drumul „PDF mare” (citire_mare.ts) cu dependențele de producție: antetul cu Haiku, ca pe drumul obișnuit
const depsMare = (cerutDe: string | null, esteOprire: () => boolean, stare: (s: string) => void) => ({
  cerutDe, esteOprire, stare, antet: antetDinText, modelAntet: HAIKU, log, pauzaReluareMs: PAUZE.reluareMareMs,
})

export async function citesteDocument(supabase: Supa, doc: any, cerutDe: string | null, esteOprire: () => boolean = () => false, stare: (s: string) => void = () => {}): Promise<string> {
  // peste 60 MB (sau 'ignorat' de edge pe mărime): nu în memorie și nu prin edge (care îl refuză) — pe felii, pe disc
  // runda 3 (J3): și drumul pe felii (> 60 MB) trece prin gardă — lease + token + descărcarea numărată (nu se restituie)
  if (esteMare(doc)) return await citesteMareCuGarda(supabase, doc, cerutDe, esteOprire, stare)
  // GARDA (2)+(3): pe drumul local contorul se ține aici (pe drumul AI îl ține edge-ul, la fiecare invocare).
  // Runda 2: „continua” = token + lease; altă încercare în curs („in_curs”) → fără descărcare. După „continua”, cuIncercare
  // garantează EXACT un _rezultat: explicit pe fiecare drum, 'esec' pe excepție (download, pdfinfo/pdftotext, parser, BD).
  const meta = await metaObiect(supabase, BUCKET, doc.fisier_path)
  const garda = await gardaIncearca(supabase, doc.id, meta, 'nas:ingest')
  if (garda.actiune !== 'continua') return `garda: ${garda.actiune} — ${garda.motiv}`
  const inc = incercareGarda(supabase, doc.id, garda.token!)
  // runda 3 (J2): excepția → 'esec' + documentul 'eroare' scrise ATOMIC sub token; proceseazaIngest nu mai scrie nimic după
  try {
    return await cuIncercare(inc, () => citesteDupaGarda(supabase, doc, inc, meta, cerutDe, esteOprire, stare),
      (m) => ({ status_procesare: 'eroare', eroare: ('eroare: ' + m).slice(0, 500) }))
  } catch (e) { return 'eroare(salvat): ' + mesajEroare(e) }
}

// Runda 3 (J3): PDF > 60 MB (citire_mare.ts) sub gardă. Lease-ul se prelungește la PAUZE.leaseReinnoireMs (citirea durează
// până la ~80 min); dacă prelungirea e respinsă (token preluat) citirea se oprește la felia următoare (esteOprire).
// Descărcarea se numără la _incearca și NU se restituie la SIGTERM (contorul propriu al citire_mare poate reveni, al gărzii nu).
async function citesteMareCuGarda(supabase: Supa, doc: any, cerutDe: string | null, esteOprire: () => boolean, stare: (s: string) => void): Promise<string> {
  const meta = await metaObiect(supabase, BUCKET, doc.fisier_path)
  const garda = await gardaIncearca(supabase, doc.id, meta, 'nas:citire_mare')
  if (garda.actiune !== 'continua') return `garda: ${garda.actiune} — ${garda.motiv}`
  const inc = incercareGarda(supabase, doc.id, garda.token!)
  // runda 4 (Copilot 2): heartbeat SERIALIZAT — următoarea prelungire pleacă doar după răspunsul celei anterioare; fiecare cu
  // termen (PAUZE.marcajTermenMs); timeout / RPC fără răspuns / acceptat:false ⇒ pierdut (citirea se oprește la felia următoare)
  let pierdut = false, viu = true
  let trezeste: () => void = () => {}
  const bucla = (async () => {
    while (viu && !pierdut) {
      await new Promise<void>(res => { const t = setTimeout(res, PAUZE.leaseReinnoireMs); trezeste = () => { clearTimeout(t); res() } })
      if (!viu) break
      let r: any = null
      try { r = await cuTermen(inc.marcheaza(null), PAUZE.marcajTermenMs, 'prelungire lease') } catch (_) { r = null }
      if (r?.acceptat !== true) pierdut = true
    }
  })()
  try {
    return GESTIONAT + await cuIncercare(inc, async () => {
      const rez = await _mare.citesteMare(supabase, doc.id, depsMare(cerutDe, () => esteOprire() || pierdut, stare))
      if (pierdut) {   // lease pierdut: NU raportăm procesat/parțial, oricare ar fi rezultatul local
        await inc.inchide({ rezultat: 'predat', eroare: 'lease pierdut în timpul citirii pe felii' })
        return `garda: lease pierdut în timpul citirii pe felii — rezultat local ignorat (${rez.slice(0, 120)})`
      }
      const r = /^(eroare|reia)/.test(rez) ? 'esec' : /^(procesat|partial)/.test(rez) ? 'succes' : 'predat'
      await inc.inchide({ rezultat: r, eroare: r === 'succes' ? null : rez.slice(0, 500) })
      if (r === 'succes' && inc.raspuns?.acceptat !== true) return `garda: rezultat NECONFIRMAT de gardă (${inc.raspuns?.motiv ?? 'fără răspuns'}) — stare necunoscută, nu raportez ${rez.split(' ')[0]}`
      return rez
    })
  } catch (e) { return GESTIONAT + 'eroare: ' + mesajEroare(e) } finally { viu = false; trezeste(); await bucla }
}

// Munca unei încercări acordate de gardă (lease-ul e al nostru). Fiecare `return` închide încercarea explicit; o excepție
// ajunge în cuIncercare (→ 'esec'), apoi în proceseazaIngest (→ documentul 'eroare', ca înainte).
async function citesteDupaGarda(supabase: Supa, doc: any, inc: Incercare, meta: MetaObiect | null, cerutDe: string | null, esteOprire: () => boolean, stare: (s: string) => void): Promise<string> {
  const off = Math.max(0, Number(doc.pagina_offset) || 0)
  const termen = Date.now() + TERMENE.lucruLocalMs   // runda 3 (J2): tot lucrul local (download, pdfinfo, pdftotext) sub lease
  const { data: blob, error: dlErr } = await cuTermen(supabase.storage.from(BUCKET).download(doc.fisier_path), termen - Date.now(), 'download') as any
  if (dlErr || !blob) {
    const m = 'download: ' + (dlErr?.message || 'lipsă')
    await inc.inchide({ rezultat: 'esec', eroare: m, doc: { status_procesare: 'eroare', eroare: m.slice(0, 500) } })
    return 'eroare(salvat): download'
  }
  const bytes = new Uint8Array(await cuTermen(blob.arrayBuffer() as Promise<ArrayBuffer>, termen - Date.now(), 'download (corp)'))
  if (bytes.length > PRAG_MARE) {
    // size_bytes lipsea/greșit în BD: scriem mărimea reală (o vede și poarta edge-ului) și trecem pe drumul pe felii
    // runda 4 (Copilot 3): mărimea reală se scrie ATOMIC cu predarea (sub token), nu printr-un UPDATE direct
    await inc.inchide({ rezultat: 'predat', eroare: `peste ${Math.round(PRAG_MARE / 1048576)} MB după descărcare → citire pe felii (citire_mare)`, doc: { size_bytes: bytes.length } })
    if (inc.raspuns?.acceptat !== true) return `garda: predare NECONFIRMATĂ (${inc.raspuns?.motiv ?? 'fără răspuns'}) — stare necunoscută`
    return await citesteMareCuGarda(supabase, { ...doc, size_bytes: bytes.length }, cerutDe, esteOprire, stare)
  }
  // predat către edge (scan / fără strat de text): lease-ul se eliberează ÎNAINTE, altfel edge-ul ar primi „in_curs”;
  // contoarele nu se ating (fiecare invocare edge își ia propria încercare, numărată acolo)
  const predaLaAI = async (motiv: string) => {
    await inc.inchide({ rezultat: 'predat', eroare: motiv })
    // runda 4 (Copilot 1): ownership-ul e la edge (tokenurile lui) — orice rezultat din aval e „gestionat”, fără scriere aici
    return GESTIONAT + await citesteCuAI(supabase, doc.id, esteOprire)
  }
  const cale = `/tmp/ingest_${doc.id}.pdf`
  await Deno.writeFile(cale, bytes)
  try {
    const local = await textLocal(cale, termen)
    if (!local) return await predaLaAI('pdfinfo/pdftotext fără rezultat → AI')   // pdfinfo/pdftotext n-au putut → AI (și decide el dacă e corupt)
    const cuText = local.pagini.filter(p => p.replace(/\s/g, '').length >= PRAG_TEXT_PAGINA).length
    if (cuText / local.nPag < PRAG_DOC_TEXT) return await predaLaAI('scan / majoritar imagini → AI')   // scan sau majoritar imagini → AI
    // runda 3 (J2): marcajul in_lucru doar cu tokenul activ (scris de server; prelungește lease-ul)
    const mk = await inc.marcheaza({ status_procesare: 'in_lucru', eroare: null, procesat_de: cerutDe, procesat_la: new Date().toISOString() })
    if (mk?.acceptat !== true) return 'garda: lease pierdut înainte de scriere — documentul NU s-a atins'
    // aceeași compunere ca pe felii: peste plafon, paginile care nu mai încap intră în pagini_necitite (nu doar tăiere tăcută)
    const comp = compuneText(local.pagini, local.nPag, off, MAX_TEXT)
    const necitite = comp.necitite, text = comp.text
    let antet: any = null, tokIn = 0, tokOut = 0
    try { const a = await antetDinText(local.pagini.slice(0, 2).join('\n\n')); antet = a.antet; tokIn = a.tokIn; tokOut = a.tokOut } catch (e) { log(`#${doc.id} antet:`, (e as Error).message) }
    try { await supabase.from('ai_usage_log').insert({ function_name: 'ofertare-ingest-doc', model: HAIKU.id, tokens_in: tokIn, tokens_out: tokOut, cost_usd: tokIn * HAIKU.in + tokOut * HAIKU.out, ref_table: 'ofertare_documente_atribuire', ref_id: doc.id }) } catch (_) {}
    const upd: Record<string, unknown> = {
      text_extras: text.trim() || null, pagini: local.nPag, size_bytes: bytes.length, pagini_procesate: local.nPag, pagini_necitite: necitite,
      status_procesare: necitite.length ? 'partial' : 'procesat',
      eroare: mesajNecitite(comp),
      ocr: false, procesat_la: new Date().toISOString(), procesat_de: cerutDe,
    }
    if (antet) { upd.antet = antet; upd.revizie = antet?.revizie || doc.revizie || null }
    // runda 3 (J2): documentul se scrie de SERVER atomic cu verificarea tokenului (o încercare veche nu suprascrie una nouă)
    await inc.inchide({ rezultat: 'succes', hash: await sha256Hex(bytes), size: bytes.length, etag: meta?.etag ?? null, doc: upd })
    if (inc.raspuns?.acceptat !== true) return `garda: rezultat NECONFIRMAT (${inc.raspuns?.motiv ?? 'fără răspuns'}) — respins sau fără răspuns, stare necunoscută apelantului`
    return `${upd.status_procesare} (${local.nPag} pagini, text local${necitite.length ? `, ${necitite.length} necitite` : ''})`
  } finally { try { await Deno.remove(cale) } catch (_) {} }
}

async function candidati(supabase: Supa, licId: number): Promise<any[]> {
  const COL = 'id, licitatie_id, nume_original, tip, fisier_path, pagina_offset, revizie, status_procesare, pagini_procesate, size_bytes, eroare, citire_mare:analiza->citire_mare'
  const [{ data: docs }, { data: mari }] = await Promise.all([
    supabase.from('ofertare_documente_atribuire').select(COL)
      .eq('licitatie_id', licId).in('status_procesare', ['neprocesat', 'in_lucru', 'eroare']).not('fisier_path', 'like', '%/neincarcat/%').order('id'),
    // R6 (770): 'ignorat' DOAR pentru că depășea pragul edge-ului → se citește aici, pe felii (alte 'ignorat' rămân în pace)
    supabase.from('ofertare_documente_atribuire').select(COL)
      .eq('licitatie_id', licId).eq('status_procesare', 'ignorat').like('eroare', `${MARCAJ_PREA_MARE}%`).not('fisier_path', 'like', '%/neincarcat/%').order('id'),
  ])
  // GARDA: documentele blocate (plafon atins), în backoff sau cu altă încercare în curs (lease neexpirat) nu sunt candidate —
  // reactivare doar din ERP (owner). Decizia finală rămâne la _incearca (atomic); filtrul doar evită apeluri inutile.
  const toti = [...(docs ?? []), ...(mari ?? [])] as any[]
  const { data: garzi } = toti.length ? await supabase.from('ofertare_ingest_garda').select('doc_id, blocat, urmatoarea_dupa, incercare_token, in_curs_pana').in('doc_id', toti.map(d => d.id)) : { data: [] }
  const acum = new Date()
  const opriti = new Set(((garzi ?? []) as any[]).filter(g => opritDeGarda(g, acum)).map(g => g.doc_id))
  const out: any[] = []
  for (const d of toti) {
    if (opriti.has(d.id)) continue
    const { data: ok } = await supabase.rpc('ofertare_doc_de_citit', { p_licitatie_id: d.licitatie_id, p_doc_id: d.id, p_nume: d.nume_original, p_tip: d.tip })
    if (ok !== true) continue
    // PDF mare: intră doar dacă decizia o permite (încercări rămase, fără eșec definitiv) — altfel NU se atinge, deci nu buclează
    if (esteMare(d)) { if (decizieCitireMare(d).actiune === 'sari') continue; d._mare = true }
    // un apel lansat de tick-ul din Supabase și încă în zbor (lease 3 min) — îl lăsăm în pace
    const { data: l } = await supabase.from('ofertare_ingest_lansari').select('lansat_la').eq('doc_id', d.id).maybeSingle()
    if (l?.lansat_la && Date.now() - new Date(l.lansat_la).getTime() < 3 * 60_000) continue
    out.push(d)
  }
  // 24.09: întâi documentele esențiale pentru poarta de completitudine (fișa de date, caiete/PT, liste de
  // cantități), apoi restul în ordinea id — altfel un studiu geotehnic de 100 MB ținea „Volumul 2” în așteptare
  const ESENTIAL = ['fisa_date', 'cs_volum', 'lista_cantitati']
  const rang = (d: any) => (ESENTIAL.includes(d.tip) ? 0 : 1)
  return out.sort((x, y) => rang(x) - rang(y) || x.id - y.id)
}

// 24.09: .docx-urile (formularul de propunere tehnică, acordul contractual…) rămâneau „ignorat" — edge-ul
// ofertare-word-text există, dar nu-l apela nimeni. Aceeași logică, aici: docx = zip cu word/document.xml.
// 25.09 (E1): și .doc binar vechi, cu word-extractor (primăriile încă trimit .doc — ex. Vâlcelele, contract + formulare).
// model_contract: textul se scoate (pt etapa de clauze contractuale), dar NU intră la extragerea de cerințe tehnice —
// ofertare-cerinte acceptă doar cs_volum/clarificări/alta/formular. Fișierele-lacăt Office (~$…) nu sunt documente.
const ENTITATI: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
function xmlToText(xml: string): string {
  return xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t').replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n').replace(/<\/w:tc>/g, ' | ').replace(/<\/w:tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, e) => ENTITATI[e])
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/ \| (?=\n)/g, '').trim()
}
async function bucatiDocx(octeti: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(octeti)
  const nume = Object.keys(zip.files).filter(x => x === 'word/document.xml' || /^word\/(header|footer)\d*\.xml$/.test(x))
  nume.sort((a, b) => (a === 'word/document.xml' ? -1 : b === 'word/document.xml' ? 1 : a.localeCompare(b)))
  const bucati: string[] = []
  for (const x of nume) { const t = xmlToText(await zip.file(x)!.async('string')); if (t) bucati.push(t) }
  return bucati
}
async function bucatiDoc(octeti: Uint8Array): Promise<string[]> {
  const doc = await new (WordExtractor as any)().extract(Buffer.from(octeti))
  return [doc.getBody(), doc.getHeaders(), doc.getFooters()]
    .map((t: string) => (t || '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean)
}
async function citesteWordLicitatie(supabase: Supa, licId: number): Promise<number> {
  const { data: docs } = await supabase.from('ofertare_documente_atribuire')
    .select('id, nume_original, tip, fisier_path').eq('licitatie_id', licId).eq('status_procesare', 'ignorat').is('text_extras', null)
    .or('nume_original.ilike.%.docx,nume_original.ilike.%.doc')
  // runda 3 (J4): și calea Word trece prin gardă — blocate / în backoff / cu lease activ nu se ating; fiecare document ia token
  // (descărcarea numărată, plafon 80), iar textul se scrie de server atomic cu tokenul. Un Word corupt sau „gol” = eșec:
  // după 5 → blocat + notificare owner (înainte rămânea eligibil la fiecare tură, fără plafon).
  const lista = (docs ?? []) as any[]
  const { data: garzi } = lista.length ? await supabase.from('ofertare_ingest_garda').select('doc_id, blocat, urmatoarea_dupa, incercare_token, in_curs_pana').in('doc_id', lista.map(d => d.id)) : { data: [] }
  const acum = new Date()
  const opriti = new Set(((garzi ?? []) as any[]).filter(g => opritDeGarda(g, acum)).map(g => g.doc_id))
  let n = 0
  for (const d of lista) {
    if (!d.fisier_path || /(^|\/)~\$/.test(d.nume_original || '') || opriti.has(d.id)) continue
    const garda = await gardaIncearca(supabase, d.id, null, 'nas:word')
    if (garda.actiune !== 'continua') { log(`#${licId} word ${d.id}: garda ${garda.actiune} — ${garda.motiv}`); continue }
    const inc = incercareGarda(supabase, d.id, garda.token!)
    try {
      await cuIncercare(inc, async () => {
        const termen = Date.now() + TERMENE.lucruLocalMs
        const { data: blob, error } = await cuTermen(supabase.storage.from(BUCKET).download(d.fisier_path), termen - Date.now(), 'download word') as any
        if (error || !blob) { await inc.inchide({ rezultat: 'esec', eroare: 'download: ' + (error?.message ?? 'lipsă') }); log(`#${licId} word ${d.id}: download ${error?.message ?? 'lipsă'}`); return }
        const octeti = new Uint8Array(await cuTermen(blob.arrayBuffer() as Promise<ArrayBuffer>, termen - Date.now(), 'download word (corp)'))
        const eDocx = /\.docx$/i.test(d.nume_original || '')
        const bucati = await cuTermen(eDocx ? bucatiDocx(octeti) : bucatiDoc(octeti), termen - Date.now(), 'extragere word')
        const text = bucati.join('\n\n')
        if (text.length < 50) { await inc.inchide({ rezultat: 'esec', eroare: `doar ${text.length} caractere — probabil scan în Word` }); log(`#${licId} word ${d.id}: doar ${text.length} caractere — probabil scan în Word`); return }
        await inc.inchide({ rezultat: 'succes', size: octeti.length, doc: {
          text_extras: text.slice(0, MAX_TEXT), status_procesare: 'procesat', pagini_procesate: 0, procesat_la: new Date().toISOString(),
          eroare: `text extras din ${eDocx ? '.docx' : '.doc'} pe worker (${bucati.length} părți, ${text.length} caractere) — fără paginație fixă${d.tip === 'model_contract' ? ' · model de contract: pentru etapa clauze contractuale, nu cerințe tehnice' : ''}`,
        } })
        if (inc.raspuns?.acceptat === true) n++; else log(`#${licId} word ${d.id}: rezultat respins de gardă — nimic scris`)
      })
    } catch (e) { log(`#${licId} word ${d.id}:`, mesajEroare(e)) }
  }
  if (n) log(`#${licId}: ${n} fișiere Word citite`)
  return n
}

// R6 (runda 2): starea cozii se recitește înainte de FIECARE document. Butonul „Oprește” din UI sau rollback-ul SQL
// (activ=false) opresc tura la documentul următor, fără să rescrie nota și fără notificarea „s-a terminat” — până acum
// workerul îl vedea doar la pornire și mergea până la capăt. Citirea DEJA pornită nu se întrerupe (un PDF mare: până la
// ~85 min); pe aceea o opresc doar SIGTERM (esteOprire) sau, pe document, rollback-ul care îi strică CAS-ul pe rev.
async function coadaActiva(supabase: Supa, licId: number): Promise<boolean> {
  const { data, error } = await supabase.from('ofertare_ingest_coada').select('activ').eq('licitatie_id', licId).maybeSingle()
  if (error) { log(`#${licId} citire: starea cozii nu se citește (${error.message}) — continui`); return true }
  return (data as { activ?: boolean } | null)?.activ === true   // cast: tiparele supabase-js dau „never” (erori vechi)
}

export async function proceseazaIngest(supabase: Supa, licId: number, esteOprire: () => boolean, stare: (s: string) => void) {
  const { data: c } = await supabase.from('ofertare_ingest_coada').select('*').eq('licitatie_id', licId).maybeSingle()
  if (!c?.activ) return
  try { await citesteWordLicitatie(supabase, licId) } catch (e) { log('word:', (e as Error)?.message ?? e) }
  const esuate = new Set<number>()
  // anti-buclă (770: același document „citit” de 5421 de ori într-o activare, pentru că după fiecare trecere rămânea
  // tot candidat): de câte ori a revenit fiecare document în tura asta; peste limită → eșuat, nu încă o trecere
  const treceri = new Map<number, number>()
  let citite = 0
  const t0Tura = Date.now()
  while (!esteOprire()) {
    if (!await coadaActiva(supabase, licId)) { log(`#${licId} citire: coada a fost oprită între timp (activ=false) — mă opresc (${citite} citite în tura asta)`); return }
    // 24.09: rând între licitații — după o tură (15 documente sau 15 min) cedăm locul, dacă mai e cineva la coadă;
    // main alege următoarea după ultimul_tick (cea mai veche), deci nicio licitație nu mai stă ore după alta
    if (citite + esuate.size >= 15 || Date.now() - t0Tura > 15 * 60_000) {
      const { data: altele } = await supabase.from('ofertare_ingest_coada').select('licitatie_id').eq('activ', true).neq('licitatie_id', licId).limit(1)
      if (altele?.length) { log(`#${licId} citire: cedez rândul (${citite} citite în tura asta)`); return }
    }
    const lista = (await candidati(supabase, licId)).filter(d => !esuate.has(d.id))
    if (!lista.length) break
    const d = lista[0]
    stare(`citesc ${String(d.nume_original || d.id).split('/').pop()} (${citite + 1}; ${lista.length} rămase)`)
    const t0 = Date.now()
    const deCate = (treceri.get(d.id) ?? 0) + 1
    treceri.set(d.id, deCate)
    let rez = ''
    if (trecereBlocata(deCate, d._mare === true)) rez = `eroare: documentul revine în coadă după ${deCate - 1 === 1 ? 'o trecere' : `${deCate - 1} treceri`} în aceeași tură — oprit, ca să nu intre în buclă`
    else {
      try { rez = await citesteDocument(supabase, d, c.cerut_de ?? null, esteOprire, s => stare(`${s} (${citite + 1}; ${lista.length} rămase)`)) } catch (e) { rez = 'eroare: ' + String((e as Error)?.message ?? e) }
    }
    log(`#${licId} doc ${d.id} „${String(d.nume_original).slice(-50)}" → ${rez} · ${Math.round((Date.now() - t0) / 1000)} s`)
    if (rez.startsWith(GESTIONAT)) {
      // runda 4: după predare / pe calea pe felii, documentul NU se atinge de aici (fără fallback de 'eroare')
      const interior = rez.slice(GESTIONAT.length)
      if (/^(eroare|garda)/.test(interior)) esuate.add(d.id)
      else if (!/^(reia|întrerupt)/.test(interior)) citite++
    } else if (rez.startsWith('garda') || rez.startsWith('eroare(salvat)')) {
      // garda ține starea / eroarea e deja scrisă atomic sub token (runda 3): nicio scriere nepăzită aici
      esuate.add(d.id)   // blocat/backoff/deja citit: nu se atinge statusul (garda ține starea), nu se reia în tura asta
    } else if (rez.startsWith('eroare')) {
      esuate.add(d.id)
      await supabase.from('ofertare_documente_atribuire').update({ status_procesare: 'eroare', eroare: rez.slice(0, 500) }).eq('id', d.id).in('status_procesare', ['neprocesat', 'in_lucru'])
    } else if (rez.startsWith('reia') || rez.startsWith('întrerupt')) {
      // PDF mare: încercarea e deja numărată în BD (max. MAX_INCERCARI_MARE), se reia în tura asta; întrerupt = SIGTERM
      // (și pe drumul AI, între felii: documentul rămâne 'in_lucru' cu pagini_procesate, tura următoare continuă de acolo)
    } else citite++
    await supabase.from('ofertare_ingest_coada').update({ ultimul_tick: new Date().toISOString(), lansari: (c.lansari ?? 0) + citite + esuate.size }).eq('licitatie_id', licId)
  }
  if (esteOprire()) return
  const { data: toate } = await supabase.from('ofertare_documente_atribuire').select('status_procesare').eq('licitatie_id', licId).not('fisier_path', 'like', '%/neincarcat/%')
  const n = (s: string[]) => (toate ?? []).filter(d => s.includes(d.status_procesare)).length
  const nota = `${n(['procesat'])} procesate, ${n(['partial'])} parțiale, ${n(['eroare', 'neprocesat', 'in_lucru'])} cu eroare/epuizate (worker NAS: ${citite} citite acum, ${esuate.size} eșuate)`
  await supabase.from('ofertare_ingest_coada').update({ activ: false, terminat_la: new Date().toISOString(), nota, ultimul_tick: new Date().toISOString() }).eq('licitatie_id', licId)
  if (c.cerut_de) {
    const { data: li } = await supabase.from('ofertare_licitatii').select('nr_anunt').eq('id', licId).maybeSingle()
    await supabase.from('notifications').insert({ profile_id: c.cerut_de, type: 'info', modul: 'Ofertare', title: `Ofertare: citirea documentelor s-a terminat la ${li?.nr_anunt ?? '#' + licId}`, message: `${nota}. Poți extrage cerințele.`, link_to: '/ofertare' })
  }
  log(`#${licId}: GATA — ${nota}`)
}
