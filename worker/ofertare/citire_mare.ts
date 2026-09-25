// worker/ofertare/citire_mare.ts — R6 (26.09.2026): PDF-urile peste pragul edge-ului (60 MB) se citesc pe NAS, pe felii.
// De ce: doc 770 (Huedin, lic. 101, „Studiu geotehnic__Transgaz+Anexe.pdf”, 99.948.369 B) omora edge-ul
// ofertare-ingest-doc (Memory limit exceeded) după ce îl punea 'in_lucru', iar workerul îl relua la nesfârșit
// (coada lic. 101: „5421 citite acum” pentru 13+221 documente). PR #478 l-a oprit pe edge: peste 60 MB → 'ignorat'
// cu motivul „prea mare pentru citirea automată…”. Aici îl citim fără să-l ținem vreodată întreg în memorie:
//   1. descărcare în flux direct pe disc (URL semnat din Storage), cu plafon de mărime și SHA-256 calculat din mers;
//   2. pdfinfo → numărul de pagini (plafon de pagini);
//   3. pdftotext -layout -f/-l pe felii de pagini; felia care pică se înjumătățește până la o pagină, iar pagina care
//      tot pică intră în pagini_necitite cu motivul ei;
//   4. aceleași ieșiri ca drumul obișnuit din ingest.ts (⟦PAGINA n⟧, pagini_necitite, 'procesat'/'partial', antet Haiku),
//      plus urma citirii în analiza.citire_mare (felii, încercări, SHA-256, comparația cu manifestul SEAP).
// Anti-buclă (lecția 770): fiecare încercare se numără în BD ÎNAINTE de munca grea (compare-and-set pe
// analiza->citire_mare->>rev); după MAX_INCERCARI_MARE → 'eroare' definitiv cu motiv, iar decizia îl sare până la un
// reset manual. Nu apelează edge-ul (care refuză oricum peste 60 MB) și nu citește cu AI paginile fără text.
// Fără importuri la distanță: testele (citire_mare_test.ts) rulează fără rețea.
import { createHash } from 'node:crypto'

export const PRAG_MARE = 60 * 1024 * 1024                 // același prag ca edge-ul ofertare-ingest-doc (PR #478)
export const MARCAJ_PREA_MARE = 'prea mare pentru citirea automată'   // începutul motivului scris de edge peste prag
export const MAX_MARE_BYTES = 200 * 1024 * 1024           // limita bucket-ului „ofertare” (seap.ts: MAX_FISIER_STORAGE)
export const MAX_PAGINI_MARE = 3000
export const FELIE_PAGINI = 25
export const MAX_INCERCARI_MARE = 3
export const MAX_TEXT = 900_000                            // același plafon ca ingest.ts / edge
export const TIMP_FELIE_MS = 120_000                       // pe un apel pdftotext (o felie)
export const TIMP_DESCARCARE_MS = 20 * 60_000
export const TIMP_TOTAL_MS = 60 * 60_000                   // pe document; restul paginilor → necitite, cu motiv
export const CALE_REV_MARE = 'analiza->citire_mare->>rev'
export const METODA = 'pdftotext -layout -f/-l pe felii (worker NAS, citire_mare v1)'
const BUCKET = 'ofertare'
const marcaj = (n: number) => `⟦PAGINA ${n}⟧`
const MB = (b: number) => Math.round(b / 1048576)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---- funcții pure (testate în citire_mare_test.ts) -----------------------------------------------------------

// aceeași normalizare ca textLocal din ingest.ts: -layout umflă textul cu spații; 2+ spații → unul dublu
export function normalizeazaPagina(t: string): string {
  return t.split('\n').map(l => l.replace(/\s+$/, '').replace(/[ \t]{2,}/g, '  ')).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
// ieșirea pdftotext pe n pagini (fiecare pagină se termină cu \f) → exact n pagini normalizate
export function imparteText(out: string, n: number): string[] {
  const parti = out.split('\f')
  if (parti.length && parti[parti.length - 1].trim() === '') parti.pop()
  while (parti.length < n) parti.push('')
  return parti.slice(0, n).map(normalizeazaPagina)
}

export type DocMare = { status_procesare?: string | null; eroare?: string | null; size_bytes?: number | string | null; citire_mare?: any; analiza?: any }
export type Decizie = { actiune: 'citeste'; incercare: number } | { actiune: 'refuza'; motiv: string } | { actiune: 'sari'; motiv: string }

const ignoratPeMarime = (d: DocMare) => d.status_procesare === 'ignorat' && String(d.eroare ?? '').startsWith(MARCAJ_PREA_MARE)
const cmDin = (d: DocMare) => d.citire_mare ?? d.analiza?.citire_mare ?? null
// „mare” = peste pragul edge-ului, SAU marcat 'ignorat' de edge exact pe motivul ăsta (size_bytes poate lipsi),
// SAU cu o citire pe felii începută/eșuată (după o eroare starea devine 'eroare' — rămâne tot pe drumul ăsta)
export const esteMare = (d: DocMare) => Number(d.size_bytes) > PRAG_MARE || ignoratPeMarime(d) ||
  ['in_curs', 'eroare', 'esuat'].includes(String(cmDin(d)?.stare ?? ''))

// Cine intră pe drumul „PDF mare” și cum. 'sari' = nu se atinge (nu scrie nimic → nu poate bucla);
// 'refuza' = se scrie o singură dată starea finală cu motiv; 'citeste' = încercarea nr. `incercare`.
export function decizieCitireMare(d: DocMare): Decizie {
  if (!esteMare(d)) return { actiune: 'sari', motiv: 'sub pragul de 60 MB — drumul obișnuit' }
  const st = String(d.status_procesare ?? '')
  if (st === 'procesat' || st === 'partial') return { actiune: 'sari', motiv: `deja ${st}` }
  if (st === 'ignorat' && !ignoratPeMarime(d)) return { actiune: 'sari', motiv: 'ignorat din alt motiv decât mărimea' }
  if (!['neprocesat', 'in_lucru', 'eroare', 'ignorat'].includes(st)) return { actiune: 'sari', motiv: `stare necunoscută „${st}”` }
  const cm = cmDin(d)
  if (cm?.stare === 'esuat') return { actiune: 'sari', motiv: `oprit definitiv: ${cm.motiv ?? '?'} (se reia doar după reset manual)` }
  const marime = Number(d.size_bytes) || 0
  if (marime > MAX_MARE_BYTES) return { actiune: 'refuza', motiv: `${MB(marime)} MB > plafonul citirii pe NAS (${MB(MAX_MARE_BYTES)} MB)` }
  // încercările contează doar cât citirea e „în curs” / „eroare”; după 'gata' + reset manual al stării se pornește de la zero
  const facute = (cm && (cm.stare === 'in_curs' || cm.stare === 'eroare')) ? (Number(cm.incercari) || 0) : 0
  if (facute >= MAX_INCERCARI_MARE) {
    const ultima = cm.stare === 'in_curs' ? 'procesul s-a oprit în timpul citirii (memorie/timp/repornire)' : (cm.motiv ?? '?')
    return { actiune: 'refuza', motiv: `${facute} încercări fără rezultat — ultima: ${ultima}` }
  }
  return { actiune: 'citeste', incercare: facute + 1 }
}

// Plasa din proceseazaIngest: de câte ori poate reveni ACELAȘI document în candidați într-o singură tură.
// Normal o dată (după citire își schimbă starea); PDF-ul mare de cel mult MAX_INCERCARI_MARE ori + trecerea care
// scrie refuzul. Peste → buclă (770: același document „citit” de 5421 de ori) → se oprește.
export const trecereBlocata = (deCate: number, mare: boolean) => deCate > (mare ? MAX_INCERCARI_MARE + 1 : 1)

export type PaginaExtrasa = string | { eroare: string }
export type RezExtractor = { ok: true; pagini: string[] } | { ok: false; motiv: string }
export type Extractor = (de: number, la: number) => Promise<RezExtractor>
export type OptFelii = { felie?: number; buget?: number; oprire?: () => boolean; termenMs?: number; acum?: () => number; progres?: (de: number, la: number) => void }
export type RezFelii = { pagini: PaginaExtrasa[]; apeluri: Array<[number, number, boolean]>; oprit: null | 'oprire' | 'buget' | 'timp' }

// Fragmentarea: felii de `felie` pagini (1-based, inclusiv). Felia care pică se înjumătățește până la o pagină;
// o singură pagină care tot pică → {eroare}. După un succes felia crește la loc (x2, până la `felie`).
// Se oprește la bugetul de caractere (restul nu mai încape oricum în text_extras), la termen sau la oprire.
export async function extragePeFelii(nPag: number, extrage: Extractor, o: OptFelii = {}): Promise<RezFelii> {
  const felieMax = Math.max(1, Math.floor(o.felie ?? FELIE_PAGINI)), buget = o.buget ?? MAX_TEXT, acum = o.acum ?? Date.now
  const pagini: PaginaExtrasa[] = [], apeluri: Array<[number, number, boolean]> = []
  let de = 1, felie = felieMax, consum = 0
  let oprit: RezFelii['oprit'] = null
  while (de <= nPag) {
    if (o.oprire?.()) { oprit = 'oprire'; break }
    if (consum > buget) { oprit = 'buget'; break }
    if (o.termenMs != null && acum() > o.termenMs) { oprit = 'timp'; break }
    const la = Math.min(de + felie - 1, nPag)
    o.progres?.(de, la)
    const r = await extrage(de, la)
    apeluri.push([de, la, r.ok])
    if (!r.ok) {
      if (la > de) { felie = Math.ceil((la - de + 1) / 2); continue }
      pagini.push({ eroare: r.motiv }); de = la + 1; continue
    }
    const n = la - de + 1
    const p = r.pagini.slice(0, n)
    while (p.length < n) p.push('')
    for (const x of p) { pagini.push(x); consum += x.length + 16 }
    de = la + 1
    felie = Math.min(felieMax, felie * 2)
  }
  return { pagini, apeluri, oprit }
}

export type Compunere = { text: string; necitite: number[]; faraText: number[]; cuEroare: number[]; netrecute: number[] }
// Textul cu ⟦PAGINA n⟧ (n = pagina_offset + i + 1), ca în ingest.ts. Plafonul se aplică PE PAGINI: paginile care nu
// mai încap (sau n-au mai fost extrase) intră în pagini_necitite + o notă la final, ca pe edge — nu se pierd tăcut.
export function compuneText(pagini: PaginaExtrasa[], nPag: number, off = 0, maxText = MAX_TEXT,
  motivCoada = `TRUNCHIAT la ${Math.round(maxText / 1000)}k caractere`): Compunere {
  const faraText: number[] = [], cuEroare: number[] = [], netrecute: number[] = []
  const loc = Math.max(0, maxText - 120)   // loc pentru nota de la final
  let text = ''
  for (let i = 0; i < nPag; i++) {
    const nr = off + i + 1
    if (netrecute.length || i >= pagini.length) { netrecute.push(nr); continue }
    const p = pagini[i]
    let bucata: string, cat: number[] | null = null
    if (typeof p !== 'string') { cat = cuEroare; bucata = `${marcaj(nr)}\n[PAGINA ${nr}: NECITITĂ — ${p.eroare}]\n\n` }
    else if (p.replace(/\s/g, '').length < 20) { cat = faraText; bucata = `${marcaj(nr)}\n[PAGINA ${nr}: fără text în stratul PDF — probabil imagine/planșă]\n\n` }
    else bucata = `${marcaj(nr)}\n${p}\n\n`
    if (text.length + bucata.length > loc) { netrecute.push(nr); continue }
    cat?.push(nr)
    text += bucata
  }
  if (netrecute.length) text += `[${motivCoada} — paginile ${netrecute[0]}-${netrecute[netrecute.length - 1]} necitite]`
  const necitite = [...faraText, ...cuEroare, ...netrecute].sort((a, b) => a - b)
  return { text, necitite, faraText, cuEroare, netrecute }
}

const lista = (a: number[]) => `${a.slice(0, 20).join(', ')}${a.length > 20 ? '…' : ''}`
const pag = (n: number) => `${n} pagin${n === 1 ? 'ă' : 'i'}`
// Pentru cazul obișnuit (doar pagini fără text) mesajul e IDENTIC cu cel de până acum din ingest.ts.
export function mesajNecitite(c: Compunere, motivCoada = 'text trunchiat la 900k caractere'): string | null {
  const parti: string[] = []
  if (c.faraText.length) parti.push(`${pag(c.faraText.length)} fără text (imagini): ${lista(c.faraText)}`)
  if (c.cuEroare.length) parti.push(`${pag(c.cuEroare.length)} pe care pdftotext a eșuat: ${lista(c.cuEroare)}`)
  if (c.netrecute.length) parti.push(`paginile ${c.netrecute[0]}-${c.netrecute[c.netrecute.length - 1]} necitite (${motivCoada})`)
  return parti.length ? parti.join('; ') : null
}

// ---- efecte (proces, disc, rețea) --------------------------------------------------------------------------

export async function ruleaza(cmd: string, args: string[], timeoutMs?: number): Promise<{ code: number; out: string; err: string }> {
  try {
    const p = await new Deno.Command(cmd, { args, stdout: 'piped', stderr: 'piped', ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) }).output()
    const dec = new TextDecoder()
    const err = dec.decode(p.stderr) + (p.signal ? ` [oprit: ${p.signal}${timeoutMs ? `, plafon ${Math.round(timeoutMs / 1000)} s` : ''}]` : '')
    return { code: p.code, out: dec.decode(p.stdout), err }
  } catch (e) { return { code: -1, out: '', err: String((e as Error)?.message ?? e) } }
}

export async function paginiPdf(cale: string): Promise<{ nPag: number } | { motiv: string }> {
  const r = await ruleaza('pdfinfo', [cale], 60_000)
  const m = r.out.match(/^Pages:\s+(\d+)/m)
  if (!m) return { motiv: `pdfinfo: ${(r.err || r.out).trim().slice(0, 200) || 'cod ' + r.code}` }
  return { nPag: Number(m[1]) }
}

export const extractorPdftotext = (cale: string, timeoutMs = TIMP_FELIE_MS): Extractor => async (de, la) => {
  const r = await ruleaza('pdftotext', ['-layout', '-enc', 'UTF-8', '-f', String(de), '-l', String(la), cale, '-'], timeoutMs)
  if (r.code !== 0) return { ok: false, motiv: `pdftotext cod ${r.code}: ${r.err.trim().slice(0, 150)}` }
  return { ok: true, pagini: imparteText(r.out, la - de + 1) }
}

// Flux HTTP → fișier, fără să țină fișierul în memorie; numără octeții (plafon) și calculează SHA-256 din mers.
export async function descarcaPeDisc(url: string, cale: string, maxBytes = MAX_MARE_BYTES, timeoutMs = TIMP_DESCARCARE_MS): Promise<{ marime: number; sha256: string }> {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!r.ok || !r.body) { try { await r.body?.cancel() } catch (_) { /* nimic */ } throw new Error(`HTTP ${r.status}`) }
  const h = createHash('sha256')
  let n = 0
  const numara = new TransformStream<Uint8Array, Uint8Array>({
    transform(bucata, ctl) {
      n += bucata.length
      if (n > maxBytes) { ctl.error(new Error(`peste plafonul de ${MB(maxBytes)} MB`)); return }
      h.update(bucata); ctl.enqueue(bucata)
    },
  })
  const f = await Deno.open(cale, { write: true, create: true, truncate: true })
  await r.body.pipeThrough(numara).pipeTo(f.writable)   // pipeTo închide fișierul (și la eroare)
  return { marime: n, sha256: h.digest('hex') }
}

export type DepsMare = {
  cerutDe: string | null
  esteOprire?: () => boolean
  stare?: (s: string) => void
  // antetul (obiectiv/beneficiar/…/revizie) din primele 2 pagini — Haiku în producție (ingest.ts), lipsă în teste
  antet?: (text: string) => Promise<{ antet: any; tokIn: number; tokOut: number }>
  modelAntet?: { id: string; in: number; out: number }
  pagini?: (cale: string) => Promise<{ nPag: number } | { motiv: string }>
  extractor?: (cale: string) => Extractor
  felie?: number
  dirLucru?: string
  pauzaReluareMs?: number
  log?: (...a: unknown[]) => void
  acum?: () => number
}

// Citirea unui PDF mare, cap-coadă. Întoarce un rezumat pentru log, cu prefixul pe care îl înțelege proceseazaIngest:
// 'eroare: …' (definitiv sau neclar — nu se mai ia în tura asta), 'reia: …' (eroare trecătoare, încercarea e deja
// numărată în BD), 'sărit: …', 'întrerupt: …' (SIGTERM), altfel starea finală ('procesat …' / 'partial …').
export async function citesteMare(supa: any, docId: number, deps: DepsMare): Promise<string> {
  const acum = deps.acum ?? Date.now
  const iso = () => new Date(acum()).toISOString()
  const log = deps.log ?? (() => {})
  const T = 'ofertare_documente_atribuire'
  const { data: doc, error: eDoc } = await supa.from(T)
    .select('id, licitatie_id, fisier_path, nume_original, status_procesare, eroare, size_bytes, pagina_offset, revizie, analiza').eq('id', docId).maybeSingle()
  if (eDoc || !doc) return `eroare: documentul ${docId} nu se citește din BD (${eDoc?.message ?? 'lipsă'})`
  const cm0 = doc.analiza?.citire_mare ?? null
  const dec = decizieCitireMare(doc)
  if (dec.actiune === 'sari') return `sărit: ${dec.motiv}`

  // scriere compare-and-set: analiza recitită (alte subarbori pot fi scriși între timp) + filtru pe rev-ul nostru
  const scrie = async (revBaza: string | null, patch: Record<string, unknown>, cm: any): Promise<boolean> => {
    const { data: f } = await supa.from(T).select('analiza').eq('id', docId).maybeSingle()
    const analiza = { ...((f?.analiza && typeof f.analiza === 'object') ? f.analiza : {}), citire_mare: cm }
    let q = supa.from(T).update({ ...patch, analiza }).eq('id', docId)
    q = revBaza == null ? q.is(CALE_REV_MARE, null) : q.eq(CALE_REV_MARE, String(revBaza))
    const { data, error } = await q.select('id')
    if (error) log(`#doc ${docId} citire_mare: scriere ${error.message}`)
    return !error && (data || []).length === 1
  }

  if (dec.actiune === 'refuza') {
    const cmR = { ...(cm0 || {}), rev: crypto.randomUUID(), stare: 'esuat', motiv: dec.motiv, terminat_la: iso(), metoda: METODA }
    const ok = await scrie(cm0?.rev ?? null, { status_procesare: 'eroare', eroare: `citire NAS (PDF mare) oprită definitiv: ${dec.motiv} — cere verificare manuală`.slice(0, 500) }, cmR)
    return `eroare: refuzat — ${dec.motiv}${ok ? '' : ' (starea nu s-a putut scrie)'}`
  }

  // 1. încercarea se numără în BD ÎNAINTE de orice muncă grea: dacă procesul moare pe drum, rămâne numărată
  const reluare = cm0 && (cm0.stare === 'in_curs' || cm0.stare === 'eroare')
  const cm: any = {
    rev: crypto.randomUUID(), stare: 'in_curs', incercari: dec.incercare, pornit_la: iso(), metoda: METODA,
    inainte: (reluare && cm0.inainte) ? cm0.inainte : { status: doc.status_procesare ?? null, eroare: doc.eroare ?? null },
    ...(reluare ? { motiv_anterior: cm0.stare === 'in_curs' ? 'procesul s-a oprit în timpul citirii' : (cm0.motiv ?? null) } : {}),
  }
  if (!await scrie(cm0?.rev ?? null, { status_procesare: 'in_lucru', eroare: null, procesat_de: deps.cerutDe, procesat_la: iso() }, cm))
    return 'eroare: nu am putut marca începutul citirii (scriere concurentă sau eroare BD) — nu citesc fără încercarea numărată'
  const revCurent = cm.rev

  const esec = async (motiv: string, definitiv = false, extra: Record<string, unknown> = {}): Promise<string> => {
    const final = definitiv || dec.incercare >= MAX_INCERCARI_MARE
    const cmE = { ...cm, ...extra, rev: crypto.randomUUID(), stare: final ? 'esuat' : 'eroare', motiv, terminat_la: iso() }
    const eroare = `citire NAS (PDF mare), încercarea ${dec.incercare}/${MAX_INCERCARI_MARE}: ${motiv}${final ? ' — oprită definitiv, cere verificare manuală' : ' — se reia'}`
    if (!await scrie(revCurent, { status_procesare: 'eroare', eroare: eroare.slice(0, 500) }, cmE)) return `eroare: ${motiv} (starea nu s-a putut scrie)`
    if (final) return `eroare: ${motiv}`
    if (deps.pauzaReluareMs) await sleep(deps.pauzaReluareMs * dec.incercare)
    return `reia: ${motiv}`
  }
  // SIGTERM: încercarea nu se consumă, documentul revine la starea dinainte (cu tot cu motivul edge-ului)
  const intrerupt = async (): Promise<string> => {
    const cmI = { ...cm, rev: crypto.randomUUID(), stare: 'eroare', incercari: dec.incercare - 1, motiv: 'întreruptă la oprirea workerului', terminat_la: iso() }
    await scrie(revCurent, { status_procesare: cm.inainte?.status ?? 'neprocesat', eroare: cm.inainte?.eroare ?? null }, cmI)
    return 'întrerupt: workerul se oprește'
  }

  const nume = String(doc.nume_original || docId).split('/').pop()
  const cale = `${deps.dirLucru ?? '/tmp'}/ingest_mare_${docId}.pdf`
  try {
    // 2. descărcare în flux pe disc
    deps.stare?.(`PDF mare ${nume}: descarc`)
    const { data: su, error: eSu } = await supa.storage.from(BUCKET).createSignedUrl(doc.fisier_path, 3600)
    if (eSu || !su?.signedUrl) return await esec(`URL semnat din Storage: ${eSu?.message ?? 'lipsă'}`)
    let dl: { marime: number; sha256: string }
    try { dl = await descarcaPeDisc(su.signedUrl, cale) }
    catch (e) { const m = String((e as Error)?.message ?? e); return await esec(`descărcare: ${m}`, /peste plafonul/.test(m)) }
    const marimeBd = Number(doc.size_bytes) || 0
    if (marimeBd && dl.marime !== marimeBd) return await esec(`descărcați ${dl.marime} B, în BD ${marimeBd} B — descărcare incompletă sau alt obiect`)
    if (deps.esteOprire?.()) return await intrerupt()

    // 3. pagini + plafon
    const pg = await (deps.pagini ?? paginiPdf)(cale)
    if ('motiv' in pg) return await esec(`PDF necitibil — ${pg.motiv}`, true, { marime: dl.marime, sha256: dl.sha256 })
    const nPag = pg.nPag
    if (nPag < 1) return await esec('PDF fără pagini', true, { marime: dl.marime, sha256: dl.sha256 })
    if (nPag > MAX_PAGINI_MARE) return await esec(`${nPag} pagini > plafonul de ${MAX_PAGINI_MARE}`, true, { marime: dl.marime, sha256: dl.sha256, pagini: nPag })

    // 4. felii
    const ex = await extragePeFelii(nPag, (deps.extractor ?? extractorPdftotext)(cale), {
      felie: deps.felie ?? FELIE_PAGINI, oprire: deps.esteOprire, termenMs: acum() + TIMP_TOTAL_MS, acum,
      progres: (de, la) => deps.stare?.(`PDF mare ${nume}: paginile ${de}-${la}/${nPag}`),
    })
    if (ex.oprit === 'oprire') return await intrerupt()
    const motivCoada = ex.oprit === 'timp' ? `OPRIT la plafonul de timp (${TIMP_TOTAL_MS / 60_000} min)` : `TRUNCHIAT la ${MAX_TEXT / 1000}k caractere`
    const c = compuneText(ex.pagini, nPag, Math.max(0, Number(doc.pagina_offset) || 0), MAX_TEXT, motivCoada)
    const cuText = nPag - c.necitite.length
    const urma = {
      marime: dl.marime, sha256: dl.sha256, pagini: nPag, felie: deps.felie ?? FELIE_PAGINI, felii: ex.apeluri.length,
      felii_esuate: ex.apeluri.filter(a => !a[2]).length, pagini_cu_text: cuText, pagini_fara_text: c.faraText.length,
      pagini_eroare: c.cuEroare, pagini_netrecute: c.netrecute.length, oprit: ex.oprit,
    }
    // un scan întreg nu devine „citit”: 0 pagini cu text = eșec explicit (OCR-ul pe bucăți e alt drum, cu cost)
    if (cuText === 0) return await esec(`niciuna din cele ${nPag} pagini nu are strat de text (scan) — pdftotext n-are ce extrage; de citit cu OCR pe bucăți`, true, urma)

    // 5. antetul, ca pe drumul obișnuit (doar dacă primele pagini au text)
    let antet: any = null
    const inceput = ex.pagini.slice(0, 2).filter((p): p is string => typeof p === 'string').join('\n\n')
    if (deps.antet && inceput.replace(/\s/g, '').length >= 120) {
      let tokIn = 0, tokOut = 0
      try { const a = await deps.antet(inceput); antet = a.antet; tokIn = a.tokIn; tokOut = a.tokOut } catch (e) { log(`#doc ${docId} antet:`, (e as Error)?.message ?? e) }
      if (deps.modelAntet) {
        try { await supa.from('ai_usage_log').insert({ function_name: 'ofertare-ingest-doc', model: deps.modelAntet.id, tokens_in: tokIn, tokens_out: tokOut, cost_usd: tokIn * deps.modelAntet.in + tokOut * deps.modelAntet.out, ref_table: T, ref_id: docId }) } catch (_) { /* nimic */ }
      }
    }

    // 6. comparația cu manifestul SEAP (R6): obiectul citit e cel din manifest?
    let manifest: { sha256: string; identic: boolean } | null = null
    try {
      const { data: m } = await supa.from('ofertare_seap_manifest').select('sha256, verificat_la').eq('document_id', docId).order('verificat_la', { ascending: false }).limit(1).maybeSingle()
      if (m?.sha256) manifest = { sha256: m.sha256, identic: m.sha256 === dl.sha256 }
    } catch (_) { /* fără manifest: rămâne null */ }

    // 7. aceleași coloane ca ingest.ts pe un PDF normal + urma în analiza.citire_mare
    const status = c.necitite.length ? 'partial' : 'procesat'
    const mesaj = mesajNecitite(c, motivCoada)
    const text = c.text.trim()
    const upd: Record<string, unknown> = {
      text_extras: text || null, pagini: nPag, size_bytes: dl.marime, pagini_procesate: nPag, pagini_necitite: c.necitite,
      status_procesare: status, eroare: mesaj ? `PDF ${MB(dl.marime)} MB citit pe NAS pe felii (pdftotext, fără AI) — ${mesaj}` : null,
      ocr: false, procesat_la: iso(), procesat_de: deps.cerutDe,
    }
    if (antet) { upd.antet = antet; upd.revizie = antet?.revizie || doc.revizie || null }
    const cmG: any = { ...cm, ...urma, rev: crypto.randomUUID(), stare: 'gata', terminat_la: iso(), caractere: text.length, manifest }
    if (!await scrie(revCurent, upd, cmG)) return 'eroare: rezultatul nu s-a putut scrie (starea citirii s-a schimbat între timp)'
    return `${status} (${nPag} pagini, PDF ${MB(dl.marime)} MB pe ${ex.apeluri.length} felii; ${cuText} cu text${c.necitite.length ? `, ${c.necitite.length} necitite` : ''}${manifest ? `; manifest ${manifest.identic ? 'identic' : 'DIFERIT'}` : ''})`
  } finally { try { await Deno.remove(cale) } catch (_) { /* nu există */ } }
}
