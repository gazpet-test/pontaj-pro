// worker/ofertare/seap.ts — aducerea documentației din SEAP pe NAS Terra (24.09.2026, decizie Răzvan).
// De ce aici: Supabase taie la 20 MB, Vercel n-a dus nici el arhivele mari. Jilava avea PT-ul ca .zip.p7s de 54 MB,
// Botoșani ca RAR în 9 volume .p7s (~850 MB) — iar platforma nu știa RAR deloc, deci caietul de sarcini lipsea TĂCUT.
// Aici: fișier cu fișier, fără limită de mărime, semnătura .p7s scoasă cu un parser DER, ZIP/RAR (și multi-volum)
// despachetate cu 7zz (7-Zip oficial), fiecare fișier urcat separat. Orice eșec își scrie MOTIVUL în ofertare_seap_fisiere.
//
// Conținut EXTERN și neîncrezător (arhivele vin de la autoritate, dar le tratăm ca input ostil):
//  - listăm întâi arhiva (7z l -slt): refuzăm căi absolute / cu „..", prea multe intrări sau dimensiune totală
//    peste plafon (zip-bomb) ÎNAINTE de a extrage;
//  - extragem într-un director temporar propriu, apoi citim doar fișierele obișnuite din el;
//  - nu executăm nimic din arhivă și nu citim nimic cu AI aici (citirea rămâne pe coada separată „Procesează").
import type { Supa } from './ingest.ts'
import { descarcaCuJurnal } from './egress.ts'   // monitor egress (docs/MONITOR_EGRESS.md): descărcările din Storage intră în jurnal
import { ghicesteTip, tipInArhiva, indiciuArhiva, esteArhiva as esteArhivaDoc, adancimeArhiva, MAX_ADANCIME_ARHIVE } from '../../supabase/functions/_shared/tipDocument.mjs'
import { shaDovedit, stareIdentitate, adaugaDocument, alegeNume, pastreazaUrcat } from '../../supabase/functions/_shared/identitateFisier.mjs'
import { desface, eSemnat, continutCms, numeDesfacut, cheieRand as cheieRandCu, cheiSeap as cheiSeapCu } from '../../supabase/functions/_shared/semnaturaCms.mjs'
import { toatePaginile } from '../../supabase/functions/_shared/paginat.mjs'

const SEAP = 'https://e-licitatie.ro/api-pub'
const SEAP_HDR: Record<string, string> = {
  Referer: 'https://e-licitatie.ro/pub',
  Origin: 'https://e-licitatie.ro',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const BUCKET = 'ofertare'
const MAX_FISIER_STORAGE = 200 * 1024 * 1024        // limita bucket-ului „ofertare"
const MAX_INTRARI = 5000                              // plafon anti zip-bomb: număr de fișiere într-o arhivă
const MAX_DESPACHETAT = 6 * 1024 * 1024 * 1024        // plafon anti zip-bomb: total despachetat (6 GB)
const MAX_INCERCARI = 3
const RECONCILIERE_MS = 60 * 60_000                   // o dată pe oră: SEAP vs BD pe licitațiile GO active
const JUNK_RE = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(0, 19).replace('T', ' '), '[seap]', ...a)

// COPIE identică cu cheieNume din ofertare-seap-import / ofertare-seap-veghe (comparația pe nume „normalizat").
export const cheieNume = (n: unknown) => String(n ?? '').replace(/\.p7s$/i, '').toLowerCase()
  .replace(/[,()]/g, '').replace(/\s+/g, '')
const estePlaceholder = (d: { fisier_path?: string | null }) => !d.fisier_path || String(d.fisier_path).includes('/neincarcat/')
// Inventarul rândurilor existente (urcate / placeholder-e): un rând rămas cu semnătura brută („X.pdf.p7s” detașată /
// nedesfăcută) își păstrează sufixul în cheie — nu e documentul „X.pdf” (Copilot NO-GO r1 pe #649). Căutarea după un nume
// SEAP încearcă toate cheile lui (cheiSeap): desfăcut, „X (semnat).pdf”, rândul brut.
export const cheieRand = (n: unknown) => cheieRandCu(String(n ?? ''), cheieNume)
export const cheiSeap = (n: unknown) => cheiSeapCu(String(n ?? ''), cheieNume)
/** Cheia evidenței pe drumul SEAP (ofertare_seap_fisiere.cheie): ca cheieNume, dar un DOCUMENT .p7s își păstrează sufixul —
 *  evidența „ok” a unei semnături detașate („Caiet.pdf.p7s” urcată brut) nu mai ascunde, la rularea următoare, documentul
 *  real „Caiet.pdf” (Copilot NO-GO r2 pe #649). Un .p7s desfăcut cu succes rămâne idempotent prin dejaUrcat (cheiSeap).
 *  Arhivele .p7s rămân pe cheia veche: pentru ele „ok” înseamnă desfăcut + extras (eșecul semnăturii e „eroare”), iar
 *  dejaDesfacutaPeSeap și poarta de completitudine (20261020a) le caută tot pe cheieNume. */
export const cheieEvidenta = (n: unknown) => {
  const s = String(n ?? '')
  return /\.p7s$/i.test(s) && !esteArhivaDoc(s) ? cheieRand(s) : cheieNume(s)
}

// Semnătura CMS (.p7s / .p7m): sursa unică în supabase/functions/_shared/semnaturaCms.mjs (aceeași regulă în edge, veghe, api).
// Varianta B (Răzvan 07.10.2026 seara): „X.pdf.p7m” → conținutul desfăcut, numele „X (semnat).pdf”; „X.rar.p7m” → „X.rar”;
// „X.pdf.p7s” → „X.pdf”. O desfacere eșuată păstrează numele original (audit Jakarinos #20).
export const semnaturaDeDesfacut = eSemnat

// Tipul după nume: sursa unică în supabase/functions/_shared/tipDocument.mjs (aceleași reguli în edge, api, UI).
export { ghicesteTip }

// -- Semnătura .p7s / .p7m (CMS / PKCS#7, DER) ---------------------------------------------------------
// Parserul structural stă în _shared/semnaturaCms.mjs (continutCms); numele vechi rămâne pentru replay_seap / teste.
/** Conținutul semnat dintr-un container CMS atașat. Aruncă eroare dacă structura nu e SignedData cu conținut. */
export const continutP7s = (b: Uint8Array): Uint8Array => continutCms(b)

// -- Arhive ----------------------------------------------------------------------------------------------
export const esteArhiva = (nume: string) => /\.(zip|rar|7z)$/i.test(nume)
/** „X.part03.rar" / „X.part03-semnat.rar" (Huedin, 24.09) → { baza: "X", nr: 3 } — volumele aceleiași arhive
 *  se despachetează împreună. Pe disc le scriem cu numele CANONIC (numeVolum), altfel 7z nu găsește volumul următor. */
export function volumRar(nume: string): { baza: string; nr: number } | null {
  const m = nume.match(/^(.*)\.part(\d+)[^./\\]*\.rar$/i)
  return m ? { baza: m[1], nr: Number(m[2]) } : null
}
export const numeVolum = (v: { baza: string; nr: number }, cifre: number) => `${v.baza}.part${String(v.nr).padStart(cifre, '0')}.rar`

// 7-Zip NU mai rulează în worker (24.09.2026, P0 Copilot): arhivele merg la containerul izolat seap-extractor
// (fără rețea, chei, .env sau alte foldere NAS; non-root, FS read-only). Comunicăm prin folderul comun LUCRU,
// cu protocolul din extractor/extractor.sh: workerul cere listarea, O VERIFICĂ el (verificaListare), apoi cere
// extragerea; extractorul impune limitele efective în timpul extragerii. Extractor oprit = eroare, nu ocolire.
const LUCRU = Deno.env.get('SEAP_LUCRU') ?? '/seap-work'
const TIMP_LISTARE_MS = 3 * 60_000, TIMP_EXTRAGERE_MS = 25 * 60_000
const scrieAtomic = async (cale: string, text: string) => { await Deno.writeTextFile(`${cale}.tmp`, text); await Deno.rename(`${cale}.tmp`, cale) }
async function asteapta(cale: string, ms: number, pasMs = 1000, semnal?: AbortSignal): Promise<boolean> {
  // AbortSignal încetează doar așteptarea; NU omoară 7z din containerul izolat.
  // Oprirea extractorului este asigurată de timeout-ul hard propriu.
  const pana = Date.now() + ms
  while (Date.now() < pana) {
    semnal?.throwIfAborted()
    try { await Deno.stat(cale); return true } catch { /* încă nu */ }
    await new Promise(r => setTimeout(r, pasMs))
  }
  return false
}
const UID_EXTRACTOR = Number(Deno.env.get('SEAP_EXTRACTOR_UID') ?? 10001)
/** Folderul unui job: al workerului (root, 755) — extractorul NU poate scrie în in/, cerere, prima sau în alte joburi
 *  ale workerului; poate scrie DOAR în out/ și rasp/ (ale lui, 700). Local (teste, fără root) chown-ul se sare. */
export async function pregatesteJob(dir: string) {
  await Deno.mkdir(`${dir}/in`, { recursive: true })
  for (const d of ['out', 'rasp']) {
    await Deno.mkdir(`${dir}/${d}`, { recursive: true })
    try { await Deno.chown(`${dir}/${d}`, UID_EXTRACTOR, UID_EXTRACTOR); await Deno.chmod(`${dir}/${d}`, 0o700) } catch { await Deno.chmod(`${dir}/${d}`, 0o777) }
  }
  await Deno.chmod(dir, 0o755); await Deno.chmod(`${dir}/in`, 0o755)
}
/** Listarea arhivei, făcută de extractor. `dir` = folderul jobului (pregatesteJob + in/<prima>). */
export async function listeazaIzolat(dir: string, prima: string, ms = TIMP_LISTARE_MS, semnal?: AbortSignal): Promise<{ code: number; out: string; err: string }> {
  semnal?.throwIfAborted()
  await Deno.writeTextFile(`${dir}/prima`, prima)
  await scrieAtomic(`${dir}/cerere`, 'l')
  if (!await asteapta(`${dir}/rasp/listare.gata`, ms, 1000, semnal)) return { code: -1, out: '', err: 'extractorul izolat (gazpet-seap-extractor) nu a răspuns la listare — e pornit?' }
  const code = Number((await Deno.readTextFile(`${dir}/rasp/listare.cod`)).trim())
  const out = await Deno.readTextFile(`${dir}/rasp/listare.txt`)
  const err = await Deno.readTextFile(`${dir}/rasp/listare.err`).catch(() => '')
  return { code, out, err }
}
/** Extragerea în <dir>/out, făcută de extractor DUPĂ ce listarea a fost aprobată. Cod ≠ 0 → motivul extractorului. */
export async function extrageIzolat(dir: string, ms = TIMP_EXTRAGERE_MS, semnal?: AbortSignal): Promise<{ code: number; motiv: string }> {
  semnal?.throwIfAborted()
  await scrieAtomic(`${dir}/cerere`, 'x')
  if (!await asteapta(`${dir}/rasp/rezultat`, ms, 1000, semnal)) return { code: -1, motiv: 'extractorul izolat nu a terminat în timp util' }
  const [cod, ...rest] = (await Deno.readTextFile(`${dir}/rasp/rezultat`)).split('\n')
  return { code: Number(cod), motiv: rest.join(' ').trim() }
}

/** Setul de volume RAR trebuie să fie complet (1..N, fără goluri), altfel nu-l trimitem la extragere. */
export function verificaVolume(nr: number[]): string | null {
  const s = [...new Set(nr)].sort((a, b) => a - b)
  if (!s.length) return 'niciun volum'
  if (s.length !== nr.length) return 'volum duplicat în SEAP'
  const lipsa = []
  for (let i = 1; i <= s[s.length - 1]; i++) if (!s.includes(i)) lipsa.push(i)
  return lipsa.length ? `set RAR incomplet: lipsește volumul ${lipsa.join(', ')} din ${s[s.length - 1]}` : null
}

/** Verificare ÎNAINTE de extragere: căi sigure, număr de intrări, dimensiune totală (anti zip-bomb). */
export function verificaListare(slt: string): { ok: true; intrari: number; total: number } | { ok: false; motiv: string } {
  let intrari = 0, total = 0
  for (const bloc of slt.split(/\n\s*\n/)) {
    const cale = bloc.match(/^Path = (.*)$/m)?.[1]
    if (!cale || /^Type = /m.test(bloc) && !/^Size = /m.test(bloc)) continue   // antetul arhivei, nu o intrare
    if (!/^Size = /m.test(bloc)) continue
    const c = cale.replace(/\\/g, '/')
    if (c.startsWith('/') || /^[a-z]:/i.test(c) || c.split('/').includes('..')) return { ok: false, motiv: `cale nesigură în arhivă: ${c.slice(0, 120)}` }
    // legături (symlink/hardlink) respinse DIN LISTARE, înainte de extragere — verificarea de după e a doua barieră
    const link = bloc.match(/^(?:Symbolic|Hard) Link = (.+)$/m)?.[1]?.trim()
    if (link || /^Attributes = .*\sl[rwx-]{9}/m.test(bloc)) return { ok: false, motiv: `legătură în arhivă (nu se extrage): ${c.slice(0, 120)}${link ? ' → ' + link.slice(0, 80) : ''}` }
    intrari++
    total += Number(bloc.match(/^Size = (\d+)$/m)?.[1] ?? 0)
    if (intrari > MAX_INTRARI) return { ok: false, motiv: `prea multe intrări (> ${MAX_INTRARI})` }
    if (total > MAX_DESPACHETAT) return { ok: false, motiv: `dimensiune despachetată peste ${MAX_DESPACHETAT / 2 ** 30} GB` }
  }
  if (!intrari) return { ok: false, motiv: 'arhivă goală sau necitită (7z nu a listat nicio intrare)' }
  return { ok: true, intrari, total }
}

async function* fisiereDin(dir: string, rel = ''): AsyncGenerator<{ cale: string; rel: string }> {
  for await (const e of Deno.readDir(dir)) {
    const cale = `${dir}/${e.name}`, r = rel ? `${rel}/${e.name}` : e.name
    if (e.isSymlink) continue                          // nu urmăm legături din arhivă
    if (e.isDirectory) yield* fisiereDin(cale, r)
    else if (e.isFile) yield { cale, rel: r }
  }
}

// -- Descărcarea din SEAP ----------------------------------------------------------------------------
function cookieDin(r: Response): string {
  let brute: string[] = []
  try { brute = (r.headers as any).getSetCookie?.() || [] } catch { /* runtime vechi */ }
  if (!brute.length) { const unul = r.headers.get('set-cookie'); if (unul) brute = [unul] }
  return brute.map(c => String(c).split(';')[0].trim()).filter(p => p.includes('=')).join('; ')
}

type DocSeap = { nume: string; url: string }
export async function listaSeap(cNotice: number, tip: number, semnal?: AbortSignal): Promise<{ docs: DocSeap[]; cookie: string }> {
  const r = await fetch(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?initNoticeId=${cNotice}&sysNoticeTypeId=${tip}`, { headers: SEAP_HDR, signal: semnal })
  if (!r.ok) throw new Error(`lista SEAP HTTP ${r.status}`)
  const cookie = cookieDin(r)
  const d = await r.json()
  const docs: DocSeap[] = []
  for (const k of ['dfNoticeDocs', 'contractingStrategyDocs', 'duaeDocs', 'decisionDocs', 'exAnteDocs']) {
    for (const f of (d?.[k] || [])) {
      const nume = String(f?.noticeDocumentName || ''), url = String(f?.noticeDocumentUrl || '')
      if (nume && url) docs.push({ nume, url })
    }
  }
  return { docs, cookie }
}

export async function descarca(doc: DocSeap, cookie: string, tinta: string, semnal?: AbortSignal): Promise<number> {
  const link = doc.url.startsWith('http') ? doc.url : `https://e-licitatie.ro/${doc.url.replace(/^\/+/, '')}`
  const r = await fetch(link, { headers: cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR, signal: semnal })
  if (!r.ok || !r.body) throw new Error(`descărcare HTTP ${r.status}`)
  const f = await Deno.open(tinta, { write: true, create: true, truncate: true })
  await r.body.pipeTo(f.writable, { signal: semnal })  // flux direct pe disc — fără limită de memorie
  return (await Deno.stat(tinta)).size
}

const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('')

// -- Urcarea unui fișier + rândul în BD (aceleași reguli ca ofertare-seap-import) ---------------------------
async function urca(supa: Supa, licId: number, numeFinal: string, buf: Uint8Array, placeholders: Map<string, number>, extra: Record<string, unknown> = {}, numeSeap: string | null = null): Promise<string | { id: number }> {
  if (buf.length > MAX_FISIER_STORAGE) return `peste limita de stocare (${Math.round(buf.length / 2 ** 20)} MB > 200 MB)`
  const estePdf = /\.pdf$/i.test(numeFinal) || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
  const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180)
  const path = `${licId}/atribuire/${Date.now().toString(36)}_${safe}`
  const { error: eUp } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' })
  if (eUp) return `urcare: ${eUp.message}`
  const rand = {
    licitatie_id: licId, fisier_path: path, nume_original: numeFinal, tip: ghicesteTip(numeFinal), size_bytes: buf.length,
    // 07.10.2026: o arhivă extrasă dintr-o arhivă intră „neprocesat”, fără notă → o despachetează bucla de mai jos
    // (același extractor izolat, limite, MAX_ADANCIME_ARHIVE). Înainte rămânea „ignorat”: necitită, fără semnal.
    status_procesare: estePdf || esteArhivaDoc(numeFinal) ? 'neprocesat' : 'ignorat',
    eroare: estePdf || esteArhivaDoc(numeFinal) ? null : 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)',
    sursa: 'seap',
    ...extra,
  }
  // placeholder-ul (pus de veghe) se completează O SINGURĂ DATĂ: consumat la prima folosire și UPDATE doar dacă e încă
  // placeholder (audit Jakarinos 07.10, #2). Altfel „Anexa (1).pdf” și „Anexa 1.pdf” (aceeași cheie, conținut diferit) scriau
  // amândouă în același rând — al doilea îl înlocuia pe primul, iar obiectul primului rămânea orfan în Storage.
  // var. B: „X (semnat).pdf” completează placeholder-ul veghei pus pe numele SEAP („X.pdf.p7m”)
  const k = placeholders.has(cheieRand(numeFinal)) || !numeSeap ? cheieRand(numeFinal) : cheieRand(numeSeap)
  const idPh = placeholders.get(k)
  if (idPh) {
    placeholders.delete(k)
    const { data: compl, error: eC } = await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh)
      .or('fisier_path.is.null,fisier_path.like.%/neincarcat/%').select('id')
    if (eC) { await supa.storage.from(BUCKET).remove([path]); return `rând BD: ${eC.message}` }
    if ((compl || []).length === 1) return { id: (compl as any)[0].id as number }
    // completat între timp de alt drum → rând nou, nu suprascriere
  }
  const { data, error } = await supa.from('ofertare_documente_atribuire').insert(rand).select('id').single()
  if (error) { await supa.storage.from(BUCKET).remove([path]); return `rând BD: ${error.message}` }
  return { id: (data as any).id as number }
}

// -- O licitație ------------------------------------------------------------------------------------
type ManifestRand = { licitatie_id: number; arhiva_cheie: string; cale: string; marime: number; sha256: string; document_id: number | null; stare: 'urcat' | 'deja_in_platforma' | 'eroare_urcare' | 'ignorat'; motiv: string | null; verificat_la: string }
type Raport = { seap: number; deja: number; adusi: number; fisiere_urcate: number; erori: string[]; sarite: number }

// -- Identitatea unui fișier extras pe drumul SEAP (07.10.2026, review PR #641 + Copilot NO-GO r1 pe #643) -----------------
// Înainte: „deja în platformă” = aceeași cheieNume, ORICARE ar fi conținutul („Caiet de sarcini.pdf” din Lot1.zip și din
// Lot2.zip → unul singur; „X.PDF” / „x.pdf” → unul pierdut, marcat „deja_in_platforma” cu id-ul celuilalt). Acum regula din
// _shared/identitateFisier.mjs, aceeași ca în ZIP-ul inline din edge: „deja” doar cu sha256 DOVEDIT (manifest 'urcat');
// altfel numele exact dacă e liber, apoi prefixul arhivei („Lot2/Caiet….pdf”), apoi sha-ul în nume.
export function prefixArhiva(numeArhiva: string): string {
  const n = String(numeArhiva ?? '').replace(/\.p7[ms]$/i, '')
  return (volumRar(n)?.baza ?? n.replace(/\.(zip|rar|7z)$/i, '')).replace(/[\\/]+/g, '_').trim() || 'arhiva'
}

/** Un document a cărui semnătură nu s-a putut desface (sau e doar semnătura, detașată) intră „ignorat”, cu nota explicită —
 *  nu ca „non-PDF” anonim și nici ca PDF fals (audit Jakarinos #20). Poarta de completitudine îl numără (fără bifa unui om)
 *  abia după migrarea 20261020a (#11): până atunci view-ul exclude orice nume .p7s/.p7m (Jakarinos #1 pe #649).
 *  O ARHIVĂ nedesfăcută nu primește notă: intră „neprocesat”, iar bucla de arhive încearcă și scrie eroarea, vizibil. */
export const notaSemnatura = (nota: string | null, nume: string): Record<string, unknown> =>
  nota && !esteArhivaDoc(nume) ? { status_procesare: 'ignorat', eroare: nota } : {}

async function inregistreaza(supa: Supa, licId: number, nume: string, rez: { stare: 'identificat' | 'ok' | 'eroare' | 'sarit'; etapa?: string; motiv?: string; marime?: number; sha?: string; extrase?: number; faraReincercare?: boolean }) {
  const cheie = cheieEvidenta(nume)
  const { data: vechi } = await supa.from('ofertare_seap_fisiere').select('id, incercari').eq('licitatie_id', licId).eq('cheie', cheie).maybeSingle()
  const rand = {
    licitatie_id: licId, nume_seap: nume, cheie, stare: rez.stare, etapa: rez.etapa ?? null, motiv: rez.motiv ?? null, marime: rez.marime ?? null,
    sha256: rez.sha ?? null, fisiere_extrase: rez.extrase ?? null, procesat_la: new Date().toISOString(),
    // respinsă de controalele de securitate → nu se reîncearcă automat (rămâne vizibilă cu motivul, nu „ignorată")
    incercari: rez.faraReincercare ? MAX_INCERCARI : rez.stare === 'eroare' ? (vechi?.incercari ?? 0) + 1 : rez.stare === 'identificat' ? (vechi?.incercari ?? 0) : (vechi?.incercari ?? 1),
  }
  const { error } = vechi
    ? await supa.from('ofertare_seap_fisiere').update(rand).eq('id', vechi.id)
    : await supa.from('ofertare_seap_fisiere').insert(rand)
  if (error) log(`#${licId}: evidența ${nume}: ${error.message}`)
}

export async function aduLicitatie(supa: Supa, licId: number, stare: (s: string) => void): Promise<Raport> {
  const raport: Raport = { seap: 0, deja: 0, adusi: 0, fisiere_urcate: 0, erori: [], sarite: 0 }
  const { data: lic, error: eL } = await supa.from('ofertare_licitatii').select('id, nr_anunt, c_notice_id, sys_notice_type_id').eq('id', licId).single()
  if (eL || !lic?.c_notice_id || !lic?.sys_notice_type_id) { raport.erori.push('licitația nu are anunț SEAP legat'); return raport }

  const { docs, cookie } = await listaSeap(lic.c_notice_id, lic.sys_notice_type_id)
  raport.seap = docs.length
  // inventarele pe pagini, fail-closed (audit Jakarinos #21): o listă trunchiată sau o eroare de citire NU e „nimic în platformă”
  const { data: dinBd, error: eBd } = await toatePaginile((de: number, la: number) => supa.from('ofertare_documente_atribuire')
    .select('id, nume_original, fisier_path').eq('licitatie_id', licId).order('id').range(de, la))
  if (eBd) { raport.erori.push(`inventarul documentelor nu s-a putut citi: ${eBd.message}`); return raport }
  const urcate = new Map((dinBd || []).filter(d => !estePlaceholder(d)).map(d => [cheieRand(d.nume_original), d.id as number]))
  // fișierele extrase din arhive: „deja” doar cu sha256 dovedit de manifest ('urcat') — _shared/identitateFisier.mjs
  const { data: manUrcat, error: eMan } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest')
    .select('arhiva_cheie, cale, document_id, sha256, stare').eq('licitatie_id', licId).eq('stare', 'urcat').not('document_id', 'is', null).order('id').range(de, la))
  if (eMan) { raport.erori.push(`manifestul nu s-a putut citi: ${eMan.message}`); return raport }
  const identitate = stareIdentitate((dinBd || []).filter(d => !estePlaceholder(d)), shaDovedit(manUrcat || []), cheieNume)
  const placeholders = new Map((dinBd || []).filter(estePlaceholder).map(d => [cheieRand(d.nume_original), d.id as number]))
  const { data: evid, error: eEv } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_fisiere')
    .select('cheie, stare, incercari').eq('licitatie_id', licId).order('id').range(de, la))
  if (eEv) { raport.erori.push(`evidența SEAP nu s-a putut citi: ${eEv.message}`); return raport }
  const evidenta = new Map((evid || []).map(e => [e.cheie, e]))

  // ce lipsește: nu e document urcat și nu e deja tratat cu succes (arhivele nu apar niciodată ca document)
  const lipsa = docs.filter(d => {
    const k = cheieEvidenta(d.nume)
    // var. B: „X.pdf.p7m” poate fi deja în platformă brut (înainte de B) sau desfăcut ca „X (semnat).pdf” — niciunul nu se re-aduce
    const dejaUrcat = cheiSeap(d.nume).some(c => urcate.has(c))
    if (dejaUrcat || evidenta.get(k)?.stare === 'ok' || evidenta.get(k)?.stare === 'sarit') { raport.deja++; return false }
    if ((evidenta.get(k)?.incercari ?? 0) >= MAX_INCERCARI) { raport.sarite++; return false }   // motivul rămâne scris
    return true
  })
  if (!lipsa.length) return raport

  // volumele RAR ale aceleiași arhive se tratează împreună (toate sau nimic)
  const grupuri = new Map<string, DocSeap[]>()
  for (const d of lipsa) {
    const v = volumRar(d.nume.replace(/\.p7[ms]$/i, ''))
    const cheieGrup = v ? `rar:${v.baza.toLowerCase()}` : `f:${d.nume}`
    grupuri.set(cheieGrup, [...(grupuri.get(cheieGrup) || []), d])
  }
  // un volum lipsă din grup (ex. partea 3 deja „ok"?) → luăm tot grupul din lista completă SEAP
  for (const [k, g] of grupuri) {
    if (!k.startsWith('rar:')) continue
    const toate = docs.filter(d => { const v = volumRar(d.nume.replace(/\.p7[ms]$/i, '')); return v && `rar:${v.baza.toLowerCase()}` === k })
    grupuri.set(k, toate)
  }

  await Deno.mkdir(LUCRU, { recursive: true })
  // etapa 1: identificat — rămâne vizibil „în curs” dacă jobul moare înainte de rezultat (poarta: „încă în curs de aducere”)
  for (const g of grupuri.values()) for (const d of g) {
    const k = cheieEvidenta(d.nume)
    if (evidenta.get(k)?.stare !== 'eroare') await inregistreaza(supa, licId, d.nume, { stare: 'identificat', etapa: 'identificare' })
  }
  const tmp = await Deno.makeTempDir({ dir: LUCRU, prefix: `seap_${licId}_` })
  await Deno.chmod(tmp, 0o755)
  try {
    for (const [cheieGrup, grup] of grupuri) {
      const eticheta = grup.length > 1 ? `${grup[0].nume.replace(/\.part\d+\.rar(\.p7[ms])?$/i, '')} (${grup.length} volume)` : grup[0].nume
      stare(`aduc ${eticheta}`)
      const dir = `${tmp}/${raport.adusi++}`
      await pregatesteJob(dir)
      const locale: { doc: DocSeap; nume: string; cale: string; marime: number; sha: string; nota: string | null }[] = []
      let esec: string | null = null, etapaEsec = 'descarcare'
      // cifrele numărului de volum din SEAP (part01 → 2) — numele canonic trebuie să le păstreze
      const cifre = Math.max(1, ...grup.map(d => d.nume.match(/\.part(\d+)/i)?.[1].length ?? 1))
      grup.sort((a, b) => (volumRar(a.nume.replace(/\.p7[ms]$/i, ''))?.nr ?? 0) - (volumRar(b.nume.replace(/\.p7[ms]$/i, ''))?.nr ?? 0))
      for (const doc of grup) {
        try {
          const brut = `${dir}/in/descarcat.bin`
          await descarca(doc, cookie, brut)
          // semnătura (_shared/semnaturaCms.mjs): arhiva / volumul fără conținut desfăcut nu se poate extrage → eroare la
          // semnătură (se reîncearcă, ca până acum); un DOCUMENT nedesfăcut se urcă brut, sub numele lui, cu nota (#20)
          const ds = desface(await Deno.readFile(brut), doc.nume)
          if (ds.stare !== 'desfacut' && ds.stare !== 'nesemnat' && (cheieGrup.startsWith('rar:') || esteArhiva(numeDesfacut(doc.nume)))) throw new Error(`semnătura CMS: ${ds.motiv}`)
          const buf = ds.buf
          const nume = ds.nume
          const vol = cheieGrup.startsWith('rar:') ? volumRar(nume) : null
          const cale = `${dir}/in/${(vol ? numeVolum(vol, cifre) : nume).replace(/[\\/]/g, '_')}`
          await Deno.writeFile(cale, buf)
          await Deno.remove(brut)
          locale.push({ doc, nume, cale, marime: buf.length, sha: await sha256(buf), nota: ds.nota })
        } catch (e) { esec = `${doc.nume}: ${(e as Error)?.message ?? e}`; etapaEsec = /p7s|CMS|SignedData|DER/i.test(String((e as Error)?.message)) ? 'semnatura' : 'descarcare'; break }
      }
      if (!esec && cheieGrup.startsWith('rar:')) { esec = verificaVolume(locale.map(l => volumRar(l.nume)?.nr ?? 0)); etapaEsec = 'set_volume' }
      if (esec) {
        raport.erori.push(esec)
        for (const doc of grup) await inregistreaza(supa, licId, doc.nume, { stare: 'eroare', etapa: etapaEsec, motiv: esec })
        continue
      }

      if (cheieGrup.startsWith('rar:') || (locale.length === 1 && esteArhiva(locale[0].nume))) {
        // ARHIVĂ: listăm, verificăm, extragem, urcăm fiecare fișier
        const prima = locale[0].cale.split('/').pop()!
        const lst = await listeazaIzolat(dir, prima)
        const v = lst.code === 0 ? verificaListare(lst.out) : { ok: false as const, motiv: `7z l: ${(lst.err || lst.out).slice(-300)}` }
        if (!v.ok) {
          raport.erori.push(`${eticheta}: ${v.motiv}`)
          const deSecuritate = lst.code === 0   // listarea a mers, dar conținutul a fost respins de controale
          for (const l of locale) await inregistreaza(supa, licId, l.doc.nume, { stare: 'eroare', etapa: 'listare', motiv: (deSecuritate ? 'RESPINS de controalele de siguranță: ' : '') + v.motiv, marime: l.marime, sha: l.sha, faraReincercare: deSecuritate })
          continue
        }
        stare(`despachetez ${eticheta} (${v.intrari} fișiere, ${Math.round(v.total / 2 ** 20)} MB)`)
        const out = `${dir}/out`
        const x = await extrageIzolat(dir)
        if (x.code !== 0) {
          const motiv = `extragere izolată cod ${x.code}: ${x.motiv.slice(0, 300)}`
          raport.erori.push(`${eticheta}: ${motiv}`)
          const limita = /^(LIMITĂ|RESPINS)/.test(x.motiv)   // depășire / conținut periculos → nu se reîncearcă singur
          for (const l of locale) await inregistreaza(supa, licId, l.doc.nume, { stare: 'eroare', etapa: 'extragere', motiv, marime: l.marime, sha: l.sha, faraReincercare: limita })
          continue
        }
        for (const l of locale) await Deno.remove(l.cale)          // eliberăm discul înainte de urcare
        let extrase = 0
        const eroriInterne: string[] = []
        // manifestul se calculează pe output-ul VALIDAT (extractorul a terminat, nimic nu mai scrie în out/)
        const manifest: ManifestRand[] = []
        const arhivaCheie = cheieNume(locale[0].doc.nume)
        for await (const f of fisiereDin(out)) {
          // audit Jakarinos #8: și copiii semnați („Anexa.pdf.p7s”, „Caiet.pdf.p7m”) se desfac ÎNAINTE de sha / nume / tip /
          // urcare — ca în ZIP-ul inline din edge. Manifestul păstrează calea din arhivă (cale = f.rel), sha-ul e al conținutului.
          const ds = desface(await Deno.readFile(f.cale), f.rel)
          const buf = ds.buf
          const rand: ManifestRand = { licitatie_id: licId, arhiva_cheie: arhivaCheie, cale: f.rel, marime: buf.length, sha256: await sha256(buf), document_id: null, stare: 'urcat', motiv: null, verificat_la: new Date().toISOString() }
          const alegere = JUNK_RE.test(f.rel) ? null : alegeNume(identitate, ds.nume, prefixArhiva(locale[0].doc.nume), rand.sha256)
          if (!alegere) { rand.stare = 'ignorat'; rand.motiv = 'fișier de sistem (junk)' }
          else if ('deja' in alegere) {   // același conținut dovedit; propria urcare anterioară își păstrează rândul 'urcat' (dovada)
            extrase++; rand.document_id = alegere.deja
            rand.stare = pastreazaUrcat(manUrcat || [], arhivaCheie, f.rel, alegere.deja) ? 'urcat' : 'deja_in_platforma'
          }
          else {
            stare(`urc ${alegere.nume}`)
            // tipul cu indiciul arhivei, ca în bucla de platformă și în ZIP-ul inline din edge (#641, aceeași regulă peste tot)
            const r = await urca(supa, licId, alegere.nume, buf, placeholders, { tip: tipInArhiva(alegere.nume, indiciuArhiva(locale[0].doc.nume)), ...notaSemnatura(ds.nota, ds.nume) }, f.rel)
            if (typeof r === 'string') { eroriInterne.push(`${f.rel}: ${r}`); rand.stare = 'eroare_urcare'; rand.motiv = r }
            else {
              extrase++; raport.fisiere_urcate++; rand.document_id = r.id
              if (alegere.nume !== ds.nume) rand.motiv = `nume diferit de altul cu alt conținut → urcat ca „${alegere.nume}”`
              else if (ds.nume !== f.rel) rand.motiv = `semnătura desfăcută → urcat ca „${ds.nume}”`
              urcate.set(cheieRand(alegere.nume), r.id); adaugaDocument(identitate, alegere.nume, r.id, rand.sha256)
            }
          }
          manifest.push(rand)
          await Deno.remove(f.cale)
        }
        for (let i = 0; i < manifest.length; i += 200) {
          const { error: eM } = await supa.from('ofertare_seap_manifest').upsert(manifest.slice(i, i + 200), { onConflict: 'licitatie_id,arhiva_cheie,cale' })
          if (eM) eroriInterne.push(`manifest: ${eM.message}`)   // fără manifest nu declarăm „ok”
        }
        const motiv = eroriInterne.length ? `${eroriInterne.length} fișiere neurcate: ${eroriInterne.slice(0, 5).join(' | ')}` : undefined
        if (motiv) raport.erori.push(`${eticheta}: ${motiv}`)
        for (const l of locale) {
          await inregistreaza(supa, licId, l.doc.nume, { stare: eroriInterne.length ? 'eroare' : 'ok', etapa: 'urcare', motiv, marime: l.marime, sha: l.sha, extrase })
          // placeholder-ul arhivei (pus de veghe) nu mai e „document lipsă": spunem ce s-a întâmplat cu el
          const idPh = cheiSeap(l.doc.nume).map(c => placeholders.get(c)).find(x => x != null)
          if (idPh) await supa.from('ofertare_documente_atribuire').update({ eroare: `Arhivă adusă pe Terra: ${extrase} fișiere în platformă${motiv ? ' — ' + motiv : ''}.` }).eq('id', idPh)
        }
      } else {
        // FIȘIER SIMPLU
        const l = locale[0]
        const buf = await Deno.readFile(l.cale)
        const r = await urca(supa, licId, l.nume, buf, placeholders, notaSemnatura(l.nota, l.nume), l.doc.nume)
        await Deno.remove(l.cale)
        if (typeof r === 'string') { raport.erori.push(`${l.nume}: ${r}`); await inregistreaza(supa, licId, l.doc.nume, { stare: 'eroare', etapa: 'urcare', motiv: r, marime: l.marime, sha: l.sha }) }
        else {
          raport.fisiere_urcate++; urcate.set(cheieRand(l.nume), r.id); adaugaDocument(identitate, l.nume, r.id, l.sha)
          // audit Jakarinos #15: și fișierul simplu lasă dovada sha ('urcat'), ca în edge (aceeași cheie: numele, fără .p7s) —
          // altfel același PDF găsit apoi într-o arhivă nu era recunoscut și se urca a doua oară, cu prefix
          const cale = l.nume.replace(/\.p7s$/i, '')
          const { error: eM } = await supa.from('ofertare_seap_manifest').upsert({ licitatie_id: licId, arhiva_cheie: cale.toLowerCase(), cale, marime: l.marime, sha256: l.sha, document_id: r.id, stare: 'urcat', motiv: null, verificat_la: new Date().toISOString() }, { onConflict: 'licitatie_id,arhiva_cheie,cale' })
          if (eM) log(`#${licId}: manifest ${l.nume}: ${eM.message}`)
          await inregistreaza(supa, licId, l.doc.nume, { stare: 'ok', etapa: 'urcare', marime: l.marime, sha: l.sha, extrase: 1 })
        }
      }
      await Deno.remove(dir, { recursive: true }).catch(() => {})
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {})
  }
  return raport
}

// -- R6: verificarea periodică SEAP → Storage (hash), fără SSH -----------------------------------------
// O licitație GO activă pe tură, doar dacă ultima ei verificare e mai veche de 7 zile. Rulează în proces
// verificaManifest (același cod ca rularea manuală), cu plafon de timp; rezultatul
// rămâne în ofertare_seap_manifest (verificat_la). Nu urcă și nu modifică documente.
const VERIFICARE_INTERVAL_MS = 7 * 24 * 3600_000
const VERIFICARE_PLAFON_MS = 30 * 60_000
let ultimaCautareVerificare = 0
async function verificarePeriodica(supa: Supa, stare: (s: string) => void) {
  if (Date.now() - ultimaCautareVerificare < RECONCILIERE_MS) return
  ultimaCautareVerificare = Date.now()
  const { data: active } = await supa.from('ofertare_licitatii').select('id')
    .eq('decizie_go', 'go').not('c_notice_id', 'is', null).gt('termen_depunere', new Date().toISOString())
  for (const a of active || []) {
    const { data: ult } = await supa.from('ofertare_seap_manifest').select('verificat_la').eq('licitatie_id', a.id)
      .order('verificat_la', { ascending: false }).limit(1).maybeSingle()
    if (ult && Date.now() - new Date(ult.verificat_la).getTime() < VERIFICARE_INTERVAL_MS) continue
    stare(`#${a.id} verificare hash SEAP ↔ Storage`)
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), VERIFICARE_PLAFON_MS)
    try {
      const { verificaManifest } = await import('./verifica_manifest_lib.ts')
      const r = await verificaManifest(supa, a.id, { semnal: ctl.signal })
      log(`#${a.id}: verificare ${r.erori.length ? 'EȘEC' : 'ok'} — identice ${r.identice}, diferite ${r.diferite}, lipsă ${r.lipsa_in_platforma}`)
      if (r.erori.length) log(r.erori.join(' | ').slice(-500))
    } catch (e) {
      log(`#${a.id}: verificare oprită — ${(e as Error)?.message ?? e}`)
    } finally { clearTimeout(t) }
    return   // una pe tură: nu ține bucla ocupată
  }
}

// -- Bucla: cereri + reconciliere orară ---------------------------------------------------------------
let ultimaReconciliere = 0
let lucruCuratat = false
export async function proceseazaSeap(supa: Supa, oprire: () => boolean, stare: (s: string) => void) {
  // joburi rămase dintr-o oprire bruscă (restart în mijlocul extragerii) — nu le lăsăm să ocupe discul
  if (!lucruCuratat) {
    lucruCuratat = true
    try { for await (const e of Deno.readDir(LUCRU)) if (e.name.startsWith('seap_')) await Deno.remove(`${LUCRU}/${e.name}`, { recursive: true }).catch(() => {}) } catch { /* nu există încă */ }
  }
  // reconcilierea: licitațiile GO cu termen în viitor intră în coadă o dată pe oră (doar dacă n-au cerere mai nouă)
  if (Date.now() - ultimaReconciliere >= RECONCILIERE_MS) {
    ultimaReconciliere = Date.now()
    const { data: active } = await supa.from('ofertare_licitatii').select('id')
      .eq('decizie_go', 'go').not('c_notice_id', 'is', null).gt('termen_depunere', new Date().toISOString())
    for (const a of active || []) {
      await supa.from('ofertare_seap_cereri').upsert({ licitatie_id: a.id, cerut_la: new Date().toISOString(), sursa: 'reconciliere' }, { onConflict: 'licitatie_id', ignoreDuplicates: false })
    }
  }
  // un rând per licitație (tabel mic): filtrul „restantă” se aplică ÎNAINTE de plafonul de 20 (audit Jakarinos 07.10, #6) —
  // altfel 20 de cereri vechi, terminate, ale unor licitații inactive (cerut_la mic, nereîmprospătat) ocupau toate locurile
  // și o cerere nouă nu mai era luată niciodată. PostgREST nu compară două coloane, deci filtrul rămâne în JS.
  const { data: toateCererile } = await supa.from('ofertare_seap_cereri').select('licitatie_id, cerut_la, terminat_la, cerut_de, sursa').order('cerut_la').limit(1000)
  type Cerere = { licitatie_id: number; cerut_la: string; terminat_la: string | null; cerut_de: string | null; sursa: string | null }
  const cereri = ((toateCererile || []) as unknown as Cerere[]).filter(c => !(c.terminat_la && new Date(c.terminat_la) >= new Date(c.cerut_la))).slice(0, 20)
  for (const c of cereri) {
    if (oprire()) return
    await supa.from('ofertare_seap_cereri').update({ preluat_la: new Date().toISOString() }).eq('licitatie_id', c.licitatie_id)
    let raport: Raport | { eroare: string }
    try {
      raport = await aduLicitatie(supa, c.licitatie_id, s => stare(`#${c.licitatie_id} ${s}`))
      log(`#${c.licitatie_id}: SEAP ${raport.seap}, deja ${raport.deja}, urcate ${raport.fisiere_urcate}, erori ${raport.erori.length}`)
    } catch (e) {
      raport = { eroare: String((e as Error)?.message ?? e) }
      log(`#${c.licitatie_id}: eșec — ${raport.eroare}`)
    }
    // „terminat” doar pentru cererea PRELUATĂ: dacă între timp a venit una nouă (cerut_la schimbat), rămâne restantă și se
    // reia la tura următoare — altfel terminat_la scris acum o acoperea fără să fi fost procesată (audit Jakarinos 07.10, #6)
    const { data: inchisa } = await supa.from('ofertare_seap_cereri').update({ terminat_la: new Date().toISOString(), raport })
      .eq('licitatie_id', c.licitatie_id).eq('cerut_la', c.cerut_la).select('licitatie_id')
    if (!(inchisa || []).length) await supa.from('ofertare_seap_cereri').update({ raport }).eq('licitatie_id', c.licitatie_id)
    // cine a cerut de mână află rezultatul (reconcilierea orară nu trimite notificări, doar când urcă ceva nou)
    const r = raport as Raport
    const deSpus = c.sursa === 'om' || (r.fisiere_urcate ?? 0) > 0 || (r.erori?.length ?? 0) > 0
    if (deSpus && c.cerut_de) {
      await supa.from('notifications').insert({
        profile_id: c.cerut_de, type: (r.erori?.length || (raport as any).eroare) ? 'warning' : 'info', modul: 'Ofertare',
        title: `Ofertare: documentația din SEAP adusă pe server (#${c.licitatie_id})`,
        message: (raport as any).eroare ? `Eșec: ${(raport as any).eroare}` : `${r.fisiere_urcate} fișiere noi urcate${r.erori.length ? `, ${r.erori.length} erori (vezi motivul la fiecare fișier)` : ''}. Apasă „Procesează" ca să fie citite.`,
        link_to: '/ofertare',
      })
    }
  }
  if (!oprire()) {
    try { await despacheteazaArhiveDinPlatforma(supa, stare, oprire) } catch (e) { log('arhive din platformă:', (e as Error)?.message ?? e) }
  }
  if (!oprire()) {
    try { await desfaSemnateDinPlatforma(supa, stare, oprire) } catch (e) { log('documente semnate din platformă:', (e as Error)?.message ?? e) }
  }
  if (!oprire()) await verificarePeriodica(supa, stare)
}

// -- Arhivele ajunse în platformă (veghe SEAP sau urcate de om) — 05.10.2026, regula permanentă (Răzvan, var. A) --------
// Veghea (edge) urcă răspunsurile și republicările din NoticeDocument/GetAll ca fișier ÎNTREG: nu poate despacheta.
// Mânăstirea, 02.10: DOC_F1_F6_C1_C9.rar (60 MB) a stat „neprocesat”, iar reconcilierea de mai sus îl socotea „deja adus”
// (același nume în BD). Aici: orice document-arhivă nedespachetat trece prin ACELAȘI extractor izolat și aceleași
// controale (verificaListare, limitele extractorului). Fiecare fișier devine document separat, într-un spațiu de nume
// PROPRIU arhivei („DOC_F1_F6_C1_C9 (#1305)/F3_….pdf”): nici documentația inițială, nici o altă arhivă cu același nume
// nu se amestecă (Copilot P1 pe #608). Fără AI și fără cost: citirea rămâne pornită de om. O arhivă pe tură.
// Volumele .partN.rar NU se despachetează aici (pot sosi pe rând — Copilot P1): se marchează „manual”, explicit.
export const ARHIVA_DOC_RE = /\.(zip|rar|7z)(\.p7[ms])?$/i
export const MARCAJ_DESPACHETARE = 'Despachetare în curs (worker NAS)'
// DOAR arhivele noi: status „neprocesat” și fără notă (veghea și urcarea din UI le pun așa). Cele ~35 de arhive vechi din
// platformă (ignorat, „non-PDF…” / „Arhivă adusă pe Terra…”, unele deja despachetate pe drumul SEAP) NU se ating
// automat — un om le poate trimite la despachetare punând status neprocesat și ștergând nota (05.10.2026, preflight live).
const STARI_ARHIVA = ['neprocesat']
type DocArhiva = { id: number; licitatie_id: number; nume_original: string; fisier_path: string | null; status_procesare: string | null; eroare: string | null; tip: string | null; seap_cod: string | null; aparut_ulterior: boolean | null }

/** Documentul e o arhivă urcată efectiv, încă nedespachetată (și nici respinsă / eșuată / marcată manual anterior). */
export function eArhivaDeDespachetat(d: Partial<DocArhiva>): boolean {
  return ARHIVA_DOC_RE.test(d.nume_original || '') && !estePlaceholder(d as { fisier_path?: string | null })
    && d.status_procesare === 'neprocesat' && !d.eroare
}
// Filtrul pe nume (PostgREST `or`); statusul, „fără notă” și „nu e placeholder” se filtrează tot pe server, ÎNAINTE de
// limit — stările finale (despachetată / parțială / respinsă / manuală) au toate notă, iar placeholder-ele n-au fișier,
// deci niciunele nu pot ocupa cele 50 de locuri (Copilot P0 r2 + r3 pe #608). Filtrul JS rămâne a doua barieră.
export const FILTRU_NUME_ARHIVA = ['zip', 'rar', '7z', 'zip.p7s', 'rar.p7s', '7z.p7s', 'zip.p7m', 'rar.p7m', '7z.p7m'].map(x => `nume_original.ilike.%.${x}`).join(',')
export const esteVolumRar = (nume: string) => !!volumRar(nume.replace(/\.p7[ms]$/i, ''))
/** Spațiul de nume al documentelor extrase: numele arhivei + id-ul rândului ei („DOC_F1_F6_C1_C9 (#1305)”). */
export const spatiuArhiva = (d: { id: number; nume_original: string }) =>
  `${(d.nume_original.replace(/\.p7[ms]$/i, '').replace(/\.(zip|rar|7z)$/i, '').replace(/[\\/]+/g, '_').trim() || 'arhiva')} (#${d.id})`

// 07.10.2026 (review #641 r2 + Copilot conv. 3): edge / api urcă arhivele SEAP de prim nivel ÎNTREGI („neprocesat”), iar
// drumul SEAP al workerului (aduLicitatie) poate să le fi desfăcut deja. Garda închide arhiva DOAR pe evidența COMPLETĂ a
// acelui drum (stare „ok” = zero fișiere neurcate, cu fișiere extrase) — altfel aceleași fișiere ar apărea a doua oară sub
// „<arhivă> (#id)/…”. O despachetare PARȚIALĂ (evidență „eroare”, sau ZIP desfăcut inline de edge cu copii eșuați) NU
// închide arhiva: bucla o desface și sare doar fișierele urcate deja cu succes (fisiereDejaImportate), deci lipsurile se
// recuperează. Doar pentru arhivele de prim nivel (cele extrase dintr-o arhivă n-au trecut pe drumul SEAP).
// Audit Jakarinos 07.10 (#3): ACEEAȘI arhivă, nu doar același nume — sha256-ul conținutului (după desfacerea semnăturii) trebuie
// să fie cel din evidență. O republicare cu alt conținut sub același nume (veghea o aduce cu cod SEAP nou) se despachetează;
// înainte era închisă cu nota falsă „fișierele ei sunt deja în platformă”. Evidență fără sha = nedovedit → se despachetează
// (dublurile sunt sărite de fisiereDejaImportate doar cu conținut dovedit — o dublură e preferabilă unei pierderi).
export async function dejaDesfacutaPeSeap(supa: Supa, d: { licitatie_id: number; nume_original: string }, sha: string): Promise<string | null> {
  if (adancimeArhiva(d.nume_original) > 0) return null
  const { data: ev } = await supa.from('ofertare_seap_fisiere').select('stare, fisiere_extrase, sha256')
    .eq('licitatie_id', d.licitatie_id).eq('cheie', cheieNume(d.nume_original)).maybeSingle()
  const e = ev as { stare?: string; fisiere_extrase?: number; sha256?: string | null } | null
  return e?.stare === 'ok' && Number(e.fisiere_extrase) > 0 && !!e.sha256 && e.sha256 === sha ? `${e.fisiere_extrase} fișiere, evidența drumului SEAP` : null
}
const caleFaraP7s = (c: unknown) => String(c ?? '').replace(/\.p7s$/i, '')
/** Ce a urcat deja un import anterior al ACESTEI arhive (manifestul drumului SEAP sau al ZIP-ului inline din edge), ca
 *  cale → sha-uri DOVEDITE. Audit Jakarinos 07.10 (#5), aceeași regulă ca #643 (_shared/identitateFisier.mjs): un rând contează
 *  doar dacă documentul lui are sha dovedit (manifest 'urcat') egal cu sha-ul rândului — un 'deja_in_platforma' vechi, scris
 *  de bugul reparat în #643 (alt conținut, id-ul celuilalt), sau un rând eșuat (document_id NULL) nu mai sare nimic. Apelantul
 *  sare un fișier doar dacă sha-ul LUI e printre cele dovedite pe aceeași cale. */
export async function fisiereDejaImportate(supa: Supa, d: { licitatie_id: number; nume_original: string }): Promise<Map<string, Set<string>>> {
  const dovedite = new Map<string, Set<string>>()
  if (adancimeArhiva(d.nume_original) > 0) return dovedite
  const cheieManifest = String(d.nume_original ?? '').replace(/\.p7s$/i, '').toLowerCase()
  // pe pagini; o eroare = nicio dovadă (se urcă tot — dublura e preferabilă pierderii), nu o listă parțială (#21)
  const { data: man } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest').select('cale, arhiva_cheie, document_id, sha256, stare')
    .eq('licitatie_id', d.licitatie_id).in('arhiva_cheie', [cheieManifest, cheieNume(d.nume_original)]).order('id').range(de, la))
  const { data: urcate } = await toatePaginile((de: number, la: number) => supa.from('ofertare_seap_manifest').select('document_id, sha256, stare')
    .eq('licitatie_id', d.licitatie_id).eq('stare', 'urcat').not('document_id', 'is', null).order('id').range(de, la))
  const shaDoc = shaDovedit(urcate || [])
  const candidati = ((man || []) as { cale: string; document_id: number | null; sha256?: string }[])
    .filter(m => m.document_id != null && !!m.sha256 && shaDoc.get(m.document_id) === m.sha256)
  if (!candidati.length) return dovedite
  // dovada contează doar dacă documentul EXISTĂ ACUM, cu fișier real (Copilot conv. 3, NO-GO r1 pe #646): un rând șters sau
  // rămas placeholder nu mai ține conținutul în platformă, deci fișierul din arhivă trebuie urcat, nu sărit ca „deja”
  // pe bucăți de 500 de id-uri (review PR-C): peste plafonul de rânduri al serverului, dovezile în plus s-ar fi pierdut tăcut
  const idDovezi = [...new Set(candidati.map(m => m.document_id as number))]
  const vii: { id: number; fisier_path: string | null }[] = []
  for (let k = 0; k < idDovezi.length; k += 500) {
    const { data } = await supa.from('ofertare_documente_atribuire').select('id, fisier_path')
      .eq('licitatie_id', d.licitatie_id).in('id', idDovezi.slice(k, k + 500))
    vii.push(...((data || []) as { id: number; fisier_path: string | null }[]))
  }
  const existente = new Set(vii.filter(x => !estePlaceholder(x)).map(x => x.id))
  for (const m of candidati) {
    if (!existente.has(m.document_id as number)) continue
    const c = caleFaraP7s(m.cale)
    dovedite.set(c, (dovedite.get(c) ?? new Set()).add(m.sha256 as string))
  }
  return dovedite
}

let arhiveCuratate = false
let arhivePauzaPana = 0     // extractorul nu răspunde → nu-l mai întrebăm la fiecare tură
export async function despacheteazaArhiveDinPlatforma(supa: Supa, stare: (s: string) => void, oprire: () => boolean = () => false): Promise<void> {
  if (!arhiveCuratate) {     // marcaj rămas dintr-o oprire bruscă: arhiva se reia (un singur worker)
    arhiveCuratate = true
    await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'neprocesat', eroare: null })
      .eq('status_procesare', 'in_lucru').eq('eroare', MARCAJ_DESPACHETARE)
  }
  if (Date.now() < arhivePauzaPana) return
  const { data: cand, error } = await supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, status_procesare, eroare, tip, seap_cod, aparut_ulterior')
    .eq('status_procesare', 'neprocesat').is('eroare', null)
    .not('fisier_path', 'is', null).not('fisier_path', 'like', '%/neincarcat/%')   // = !estePlaceholder, tot înainte de limit (Copilot P0 r3)
    .or(FILTRU_NUME_ARHIVA)
    .order('id').limit(50)
  if (error) { log(`arhive din platformă: ${error.message}`); return }
  for (const d of ((cand || []) as DocArhiva[]).filter(eArhivaDeDespachetat)) {
    if (oprire()) return
    if (esteVolumRar(d.nume_original)) {   // stare finală, explicită: nu-l mai selectăm
      await supa.from('ofertare_documente_atribuire').update({
        eroare: 'Despachetare manuală necesară: arhivă în volume (.partN.rar) — volumele pot sosi pe rând, așa că nu se despachetează automat. Descarcă toate volumele, dezarhivează local și urcă fișierele.',
      }).eq('id', d.id).in('status_procesare', STARI_ARHIVA).is('eroare', null)
      continue
    }
    if (adancimeArhiva(d.nume_original) >= MAX_ADANCIME_ARHIVE) {   // stare finală, explicită: nu-l mai selectăm
      await supa.from('ofertare_documente_atribuire').update({
        eroare: `Despachetare manuală necesară: arhivă imbricată pe nivelul ${adancimeArhiva(d.nume_original)} (limita automată e ${MAX_ADANCIME_ARHIVE} niveluri). Descarc-o, dezarhivează local și urcă fișierele.`,
      }).eq('id', d.id).in('status_procesare', STARI_ARHIVA).is('eroare', null)
      continue
    }
    await despacheteazaArhiva(supa, d, stare)   // garda drumului SEAP (dejaDesfacutaPeSeap) e înăuntru: cere sha-ul arhivei
    return     // o arhivă pe tură: nu ține bucla SEAP ocupată
  }
}

// -- Documentele SEMNATE ajunse în platformă (07.10.2026 seara, var. B, Răzvan) ------------------------------------------
// „X.pdf.p7m” / „X.docx.p7s” urcate brut — de mână din „Urcă fișiere” (le pune „neprocesat”, fără notă) sau, la reparare,
// trimise înapoi de un om (status neprocesat + notă ștearsă; lic. 92: 319–324, 327). Se desface semnătura și rândul se
// actualizează PE LOC (același id): numele „X (semnat).pdf”, obiect nou cu conținutul, status după tip. Fișierul semnat
// original NU se șterge: rămâne în Storage, legat în seap_meta.semnat (orfani.ts îl socotește folosit) — e dovada semnăturii.
// Fără AI și fără cost. Arhivele semnate le ia bucla de mai sus.
export const MARCAJ_SEMNATURA = 'Desfacere semnătură în curs (worker NAS)'
export const FILTRU_NUME_SEMNAT = ['p7s', 'p7m'].map(x => `nume_original.ilike.%.${x}`).join(',')
/** Document semnat (nu arhivă), urcat efectiv, „neprocesat” și fără notă. */
export function eSemnatDeDesfacut(d: { nume_original?: string | null; fisier_path?: string | null; status_procesare?: string | null; eroare?: string | null }): boolean {
  const n = d.nume_original || ''
  return eSemnat(n) && !ARHIVA_DOC_RE.test(n) && !estePlaceholder(d) && d.status_procesare === 'neprocesat' && !d.eroare
}
let semnateCuratate = false
export async function desfaSemnateDinPlatforma(supa: Supa, stare: (s: string) => void, oprire: () => boolean = () => false): Promise<void> {
  if (!semnateCuratate) {     // marcaj rămas dintr-o oprire bruscă: documentul se reia
    semnateCuratate = true
    await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'neprocesat', eroare: null })
      .eq('status_procesare', 'in_lucru').eq('eroare', MARCAJ_SEMNATURA)
  }
  // arhivele semnate (le ia bucla de arhive) se exclud PE SERVER, înainte de limit (Jakarinos #5 pe #649): altfel 20 de
  // „X.rar.p7m” în așteptare țineau pe loc documentele semnate cu id mai mare
  let q = supa.from('ofertare_documente_atribuire')
    .select('id, licitatie_id, nume_original, fisier_path, status_procesare, eroare, tip, seap_meta')
    .eq('status_procesare', 'neprocesat').is('eroare', null)
    .not('fisier_path', 'is', null).not('fisier_path', 'like', '%/neincarcat/%')
    .or(FILTRU_NUME_SEMNAT)
  for (const x of ['zip', 'rar', '7z']) for (const p of ['p7s', 'p7m']) q = q.not('nume_original', 'ilike', `%.${x}.${p}`)
  const { data: cand, error } = await q.order('id').limit(20)
  if (error) { log(`documente semnate din platformă: ${error.message}`); return }
  let facute = 0
  for (const d of (cand || []) as (DocArhiva & { seap_meta: Record<string, unknown> | null })[]) {
    if (oprire() || facute >= 10) return
    if (!eSemnatDeDesfacut(d)) {
      // „X.p7m” fără extensie interioară: nu știm ce e înăuntru → stare finală explicită, nu rămâne la nesfârșit în coadă
      if (!ARHIVA_DOC_RE.test(d.nume_original || '') && !estePlaceholder(d)) {
        await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'ignorat', eroare: NOTA_FARA_EXTENSIE })
          .eq('id', d.id).eq('status_procesare', 'neprocesat').is('eroare', null)
      }
      continue
    }
    facute++
    await desfaSemnat(supa, d, stare)
  }
}

async function desfaSemnat(supa: Supa, d: DocArhiva & { seap_meta: Record<string, unknown> | null }, stare: (s: string) => void): Promise<void> {
  const { data: luate } = await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'in_lucru', eroare: MARCAJ_SEMNATURA })
    .eq('id', d.id).eq('status_procesare', 'neprocesat').is('eroare', null).select('id')
  if ((luate || []).length !== 1) return
  const termina = (patch: Record<string, unknown>) => supa.from('ofertare_documente_atribuire').update(patch).eq('id', d.id).eq('eroare', MARCAJ_SEMNATURA).select('id')
  let pathNou: string | null = null
  try {
    stare(`document semnat din platformă: ${d.nume_original}`)
    const { data: blob, error } = await descarcaCuJurnal(supa, BUCKET, d.fisier_path!, 'nas:semnate', d.id)
    if (error || !blob) { await termina({ status_procesare: 'ignorat', eroare: `${NOTA_DESCARCARE}: ${error?.message ?? 'fișier gol'}. Pentru reîncercare: status neprocesat, fără notă.` }); return }
    const ds = desface(new Uint8Array(await blob.arrayBuffer()), d.nume_original)
    if (ds.stare !== 'desfacut') { await termina({ status_procesare: 'ignorat', eroare: (ds.nota ?? `${ds.motiv ?? 'nedesfăcut'}`).slice(0, 500) }); return }
    // numele desfăcut, unic în licitație (un „X (semnat).pdf” existent — alt rând — nu se suprascrie și nu se confundă)
    let numeNou = ds.nume
    const { data: ocupat } = await supa.from('ofertare_documente_atribuire').select('id').eq('licitatie_id', d.licitatie_id).eq('nume_original', numeNou).neq('id', d.id).limit(1)
    if ((ocupat || []).length) numeNou = numeNou.replace(/(\.[a-z0-9]{1,6})$/i, ` (#${d.id})$1`)
    const estePdf = /\.pdf$/i.test(numeNou) || (ds.buf[0] === 0x25 && ds.buf[1] === 0x50 && ds.buf[2] === 0x44 && ds.buf[3] === 0x46)
    const safe = numeNou.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180)
    pathNou = `${d.licitatie_id}/atribuire/${Date.now().toString(36)}_${safe}`
    const { error: eUp } = await supa.storage.from(BUCKET).upload(pathNou, ds.buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' })
    if (eUp) { pathNou = null; await termina({ status_procesare: 'ignorat', eroare: `${NOTA_DESCARCARE.replace('descărcare', 'urcare')}: ${eUp.message}. Pentru reîncercare: status neprocesat, fără notă.` }); return }
    const { data: scris, error: eScr } = await termina({
      nume_original: numeNou, fisier_path: pathNou, size_bytes: ds.buf.length, tip: d.tip || ghicesteTip(numeNou),
      status_procesare: estePdf ? 'neprocesat' : 'ignorat',
      eroare: estePdf ? null : 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)',
      seap_meta: { ...(d.seap_meta || {}), semnat: { nume: d.nume_original, path: d.fisier_path, desfacut_la: new Date().toISOString() } },
    })
    if (eScr || (scris || []).length !== 1) {   // rândul s-a schimbat între timp (om / alt proces): obiectul nou nu rămâne orfan
      await supa.storage.from(BUCKET).remove([pathNou]); pathNou = null
      if (eScr) await termina({ status_procesare: 'ignorat', eroare: `${NOTA_DESCARCARE.replace('descărcare', 'scriere')}: ${eScr.message}` })
      return
    }
    log(`#${d.licitatie_id}: ${d.nume_original} → ${numeNou} (semnătura desfăcută, ${ds.buf.length} B)`)
  } catch (e) {
    const motiv = String((e as Error)?.message ?? e)
    log(`#${d.licitatie_id}: ${d.nume_original}: excepție la desfacerea semnăturii — ${motiv}`)
    if (pathNou) await supa.storage.from(BUCKET).remove([pathNou]).catch(() => {})
    try { await termina({ status_procesare: 'ignorat', eroare: `Desfacerea semnăturii a eșuat (excepție): ${motiv}. Pentru reîncercare: status neprocesat, fără notă.`.slice(0, 500) }) } catch { /* marcajul se recuperează la repornire */ }
  }
}
const NOTA_DESCARCARE = 'Desfacerea semnăturii a eșuat (descărcare din Storage)'
export const NOTA_FARA_EXTENSIE = 'Fișier semnat fără extensia documentului din interior (ex. „X.p7m”): nu se desface automat. Descarcă-l, deschide-l cu aplicația de semnătură și urcă documentul; apoi bifează-l.'

async function despacheteazaArhiva(supa: Supa, d: DocArhiva, stare: (s: string) => void): Promise<void> {
  const licId = d.licitatie_id
  // revendicare: doar dacă nimeni nu l-a schimbat între timp (Procesează / om)
  const { data: luate } = await supa.from('ofertare_documente_atribuire').update({ status_procesare: 'in_lucru', eroare: MARCAJ_DESPACHETARE })
    .eq('id', d.id).in('status_procesare', STARI_ARHIVA).is('eroare', null).select('id')
  if ((luate || []).length !== 1) return
  const termina = (status: string, eroare: string | null) => supa.from('ofertare_documente_atribuire')
    .update({ status_procesare: status, eroare: eroare === null ? null : eroare.slice(0, 500) }).eq('id', d.id).eq('eroare', MARCAJ_DESPACHETARE)
  const spatiu = spatiuArhiva(d)
  let tmp: string | null = null
  try {
    await Deno.mkdir(LUCRU, { recursive: true })
    tmp = await Deno.makeTempDir({ dir: LUCRU, prefix: `seap_arh_${licId}_` })
    await Deno.chmod(tmp, 0o755)
    const dir = `${tmp}/0`
    await pregatesteJob(dir)
    stare(`arhivă din platformă: descarc ${d.nume_original}`)
    const { data: blob, error } = await descarcaCuJurnal(supa, BUCKET, d.fisier_path!, 'nas:arhive', d.id)
    if (error || !blob) { await termina('eroare', `Despachetare eșuată (descărcare din Storage): ${error?.message ?? 'fișier gol'}`); return }
    const ds = desface(new Uint8Array(await blob.arrayBuffer()), d.nume_original)
    if (ds.stare !== 'desfacut' && ds.stare !== 'nesemnat') { await termina('eroare', `Despachetare eșuată (semnătura CMS .p7s/.p7m): ${ds.motiv}`); return }
    const buf = ds.buf
    const nume = ds.nume
    const dejaSeap = await dejaDesfacutaPeSeap(supa, d, await sha256(buf))
    if (dejaSeap) {   // stare finală, explicită: ACEEAȘI arhivă nu se desface a doua oară (dubluri sub alt spațiu de nume)
      await termina('ignorat', `📦 Arhivă deja despachetată pe drumul SEAP (${dejaSeap}) — nu se desface a doua oară; fișierele ei sunt deja în platformă.`)
      return
    }
    const prima = nume.replace(/[\\/]/g, '_')
    await Deno.writeFile(`${dir}/in/${prima}`, buf)
    const lst = await listeazaIzolat(dir, prima)
    if (lst.code === -1) {   // extractorul oprit: nu e vina arhivei — o reluăm mai târziu
      arhivePauzaPana = Date.now() + 30 * 60_000
      log(`#${licId}: ${d.nume_original}: ${lst.err} — reiau peste 30 min`)
      await termina('neprocesat', null)
      return
    }
    const v = lst.code === 0 ? verificaListare(lst.out) : { ok: false as const, motiv: `7z l: ${(lst.err || lst.out).slice(-300)}` }
    if (!v.ok) { await termina('eroare', `Despachetare ${lst.code === 0 ? 'RESPINSĂ de controalele de siguranță' : 'eșuată (listare)'}: ${v.motiv}`); return }
    stare(`arhivă din platformă: despachetez ${d.nume_original} (${v.intrari} fișiere, ${Math.round(v.total / 2 ** 20)} MB)`)
    const x = await extrageIzolat(dir)
    if (x.code === -1) {
      arhivePauzaPana = Date.now() + 30 * 60_000
      log(`#${licId}: ${d.nume_original}: ${x.motiv} — reiau peste 30 min`)
      await termina('neprocesat', null)
      return
    }
    if (x.code !== 0) { await termina('eroare', `Despachetare ${/^(LIMITĂ|RESPINS)/.test(x.motiv) ? 'RESPINSĂ' : 'eșuată'} (extragere, cod ${x.code}): ${x.motiv.slice(0, 300)}`); return }
    await Deno.remove(`${dir}/in/${prima}`).catch(() => {})
    // o reluare (după o urcare parțială) nu dublează: comparăm DOAR cu spațiul de nume al acestei arhive, pe CALEA EXACTĂ.
    // (07.10, review #641: cu cheieNume — fără .p7s / paranteze / spații / majuscule — „PT.zip” și „PT.zip.p7s” sau
    // „Anexa (1).pdf” și „Anexa 1.pdf” din aceeași arhivă se confundau și unul se pierdea tăcut, numărat „existau deja”.)
    const { data: existente, error: eEx } = await toatePaginile((de: number, la: number) => supa.from('ofertare_documente_atribuire')
      .select('id, nume_original').eq('licitatie_id', licId).order('id').range(de, la))
    if (eEx) { await termina('neprocesat', null); log(`#${licId}: ${d.nume_original}: inventarul nu s-a putut citi (${eEx.message}) — reiau la tura următoare`); return }
    const urcate = new Set(((existente || []) as { nume_original: string }[]).map(e => e.nume_original || '').filter(n => n.startsWith(`${spatiu}/`)))
    const dinImport = await fisiereDejaImportate(supa, d)   // urcate deja cu succes de importul care a desfăcut-o parțial
    let extrase = 0, deja = 0
    const erori: string[] = []
    const manifest: ManifestRand[] = []
    const dinRularea = new Set<string>()   // numele urcate de ACEASTĂ despachetare (o coliziune aici e alt conținut, nu o reluare)
    for await (const f of fisiereDin(`${dir}/out`)) {
      if (JUNK_RE.test(f.rel)) { await Deno.remove(f.cale); continue }
      // audit Jakarinos #8: copiii semnați se desfac aici, ca pe drumul SEAP și în edge („Anexa.pdf.p7s” → „Anexa.pdf”);
      // o reluare a unei arhive desfăcute înainte de asta recunoaște și numele vechi, brut („…/Anexa.pdf.p7s”)
      const ds = desface(await Deno.readFile(f.cale), f.rel)
      const fb = ds.buf
      const shaFb = await sha256(fb)
      let numeFinal = `${spatiu}/${ds.nume}`
      // Jakarinos #2 pe #649: aceeași arhivă cu „Anexa.pdf” ȘI „Anexa.pdf.p7s” (sau „X (semnat).pdf” și „X.pdf.p7m”) dă același
      // nume după desfacere — al doilea primește sha-ul în nume, nu e sărit ca „există”
      if (dinRularea.has(numeFinal)) numeFinal = `${spatiu}/${shaFb.slice(0, 8)}_${ds.nume}`
      else if (urcate.has(numeFinal) || urcate.has(`${spatiu}/${f.rel}`)) { deja++; await Deno.remove(f.cale); continue }
      if (dinImport.get(caleFaraP7s(f.rel))?.has(shaFb)) { deja++; await Deno.remove(f.cale); continue }   // același conținut, dovedit
      stare(`arhivă din platformă: urc ${numeFinal}`)
      const r = await urca(supa, licId, numeFinal, fb, new Map(), {
        ...notaSemnatura(ds.nota, ds.nume),
        // seap_cod NU se moștenește: e unic pe (licitație, cod) — e codul documentului SEAP, adică al arhivei
        // (05.10, 1305: 159 de fișiere respinse de ofertare_doc_seap_cod_unic). Legătura cu arhiva e în nume: „(#id)”.
        // regula proprie câștigă, apoi folderul; altfel tipul arhivei — dar NU raspuns_clarificare (lic. 3: 117 formulare /
        // planșe în Clarificări) și NU planșa (un breviar dintr-o arhivă „Planșe” n-ar mai fi citit)
        tip: tipInArhiva(ds.nume, indiciuArhiva(d.nume_original, d.tip)),   // indiciul mamei: numele arhivei, apoi rândul ei
        aparut_ulterior: d.aparut_ulterior ?? null,
      })
      if (typeof r === 'string') erori.push(`${f.rel}: ${r}`)
      else {
        extrase++; urcate.add(numeFinal); dinRularea.add(numeFinal)
        // audit Jakarinos #15: dovada sha și pentru copiii buclei de platformă (cheia = spațiul de nume al arhivei, cale = în arhivă)
        manifest.push({ licitatie_id: licId, arhiva_cheie: spatiu.toLowerCase(), cale: f.rel, marime: fb.length, sha256: shaFb, document_id: r.id, stare: 'urcat', motiv: null, verificat_la: new Date().toISOString() })
      }
      await Deno.remove(f.cale)
    }
    for (let i = 0; i < manifest.length; i += 200) {
      const { error: eM } = await supa.from('ofertare_seap_manifest').upsert(manifest.slice(i, i + 200), { onConflict: 'licitatie_id,arhiva_cheie,cale' })
      if (eM) log(`#${licId}: manifest ${spatiu}: ${eM.message}`)   // dovada lipsă = cel mult o dublură mai târziu, nu o pierdere
    }
    // Copilot P0 pe #608: orice fișier neurcat ține arhiva în „eroare” (vizibil, cu lista) — cele reușite rămân;
    // o reluare manuală (status neprocesat, fără notă) sare ce există și reîncearcă doar lipsurile.
    if (erori.length) {
      await termina('eroare', `Despachetare parțială: ${extrase} fișiere noi urcate${deja ? `, ${deja} existau` : ''}, ${erori.length} NEURCATE: ${erori.slice(0, 3).join(' | ')}. Pentru reîncercare: status neprocesat, fără notă.`)
      log(`#${licId}: ${d.nume_original}: despachetare parțială — ${extrase} noi, ${erori.length} erori`)
    } else {
      await termina('ignorat', `📦 Arhivă despachetată pe Terra: ${extrase} fișiere noi în platformă, cu numele „${spatiu}/…”${deja ? `, ${deja} existau deja` : ''}. Arhiva rămâne ca fișier.`)
      log(`#${licId}: ${d.nume_original}: despachetată — ${extrase} noi, ${deja} existau`)
    }
    // cine se ocupă de licitație află că are documente noi de citit (fără AI pornit automat)
    const { data: lic } = await supa.from('ofertare_licitatii').select('responsabil_id, nr_anunt').eq('id', licId).maybeSingle()
    if (extrase && lic?.responsabil_id) {
      await supa.from('notifications').insert({
        profile_id: lic.responsabil_id, type: erori.length ? 'warning' : 'info', modul: 'Ofertare',
        title: `Ofertare: arhivă despachetată (${lic.nr_anunt || '#' + licId})`,
        message: `${d.nume_original}: ${extrase} documente noi în platformă${erori.length ? `, ${erori.length} NEURCATE (vezi motivul la arhivă)` : ''}. Citește-le cu AI doar pe cele de care ai nevoie.`,
        link_to: '/ofertare',
      })
    }
  } catch (e) {
    // după revendicare orice excepție (disc, rețea, BD) închide rândul cu motivul scris (audit Jakarinos 07.10, #7): altfel
    // rămânea „in_lucru” cu „Despachetare în curs”, exclus din selecții până la o repornire a workerului
    const motiv = String((e as Error)?.message ?? e)
    log(`#${licId}: ${d.nume_original}: excepție la despachetare — ${motiv}`)
    try { await termina('eroare', `Despachetare eșuată (excepție): ${motiv}. Pentru reîncercare: status neprocesat, fără notă.`) } catch { /* BD indisponibilă: marcajul se recuperează la repornire */ }
  } finally {
    if (tmp) await Deno.remove(tmp, { recursive: true }).catch(() => {})
  }
}
