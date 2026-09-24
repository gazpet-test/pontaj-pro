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

// aceleași reguli ca ghicesteTip din ofertare-seap-import (valorile există în CHECK-ul coloanei tip)
export function ghicesteTip(nume: string): string {
  const n = nume.toLowerCase()
  if (/fisa[_ -]?date|instructiuni_ofertanti/.test(n)) return 'fisa_date'
  if (/formular|duae/.test(n)) return 'formular'
  if (/contract/.test(n)) return 'model_contract'
  if (/cantitat|antemasur|^f[1-3][_ .-]|centralizator/.test(n)) return 'lista_cantitati'
  if (/desene|plans|plansa|schema tehnologica|\.dwg|izometri|topo/.test(n)) return 'plansa'
  if (/volum|caiet|memoriu|\bcs\b|sectiunea/.test(n)) return 'cs_volum'
  if (/raspuns|clarificar/.test(n)) return 'raspuns_clarificare'
  return 'alta'
}

// -- Semnătura .p7s (CMS / PKCS#7, DER) ----------------------------------------------------------------
// Parcurgem structura: ContentInfo → [0] SignedData → encapContentInfo → [0] OCTET STRING (poate fi „constructed",
// în bucăți de ~64 KB, și cu lungime nedefinită). Nu căutăm semnături magice în fișier — structura decide.
type Hdr = { tag: number; cons: boolean; len: number | null; hl: number }
function hdr(b: Uint8Array, p: number): Hdr {
  const tag = b[p]; let q = p + 1; let l = b[q++]
  if (l === 0x80) return { tag, cons: (tag & 0x20) !== 0, len: null, hl: q - p }
  if (l & 0x80) { const n = l & 0x7f; l = 0; for (let i = 0; i < n; i++) l = l * 256 + b[q++] }
  return { tag, cons: (tag & 0x20) !== 0, len: l, hl: q - p }
}
function sfarsit(b: Uint8Array, p: number): number {
  const h = hdr(b, p)
  if (h.len !== null) return p + h.hl + h.len
  let q = p + h.hl
  while (!(b[q] === 0 && b[q + 1] === 0)) { if (q >= b.length) throw new Error('DER trunchiat'); q = sfarsit(b, q) }
  return q + 2
}
function copii(b: Uint8Array, p: number): number[] {
  const h = hdr(b, p); const out: number[] = []; let q = p + h.hl
  const e = h.len !== null ? p + h.hl + h.len : null
  while (e !== null ? q < e : !(b[q] === 0 && b[q + 1] === 0)) { if (q >= b.length) throw new Error('DER trunchiat'); out.push(q); q = sfarsit(b, q) }
  return out
}
function octeti(b: Uint8Array, p: number, acc: Uint8Array[]) {
  const h = hdr(b, p)
  if (!h.cons) { acc.push(b.subarray(p + h.hl, p + h.hl + (h.len ?? 0))); return }
  for (const c of copii(b, p)) octeti(b, c, acc)
}
/** Conținutul semnat dintr-un .p7s atașat. Aruncă eroare dacă structura nu e SignedData cu conținut. */
export function continutP7s(b: Uint8Array): Uint8Array {
  const ci = copii(b, 0)
  if (ci.length < 2) throw new Error('p7s: ContentInfo incomplet')
  const sd = copii(b, ci[1])[0]
  const sdc = copii(b, sd)
  if (sdc.length < 3) throw new Error('p7s: SignedData incomplet')
  const eci = copii(b, sdc[2])
  if (eci.length < 2) throw new Error('p7s: semnătură detașată (fără conținut)')
  const acc: Uint8Array[] = []
  octeti(b, copii(b, eci[1])[0], acc)
  const tot = acc.reduce((s, x) => s + x.length, 0)
  const out = new Uint8Array(tot); let o = 0
  for (const x of acc) { out.set(x, o); o += x.length }
  return out
}

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
async function asteapta(cale: string, ms: number, pasMs = 1000): Promise<boolean> {
  const pana = Date.now() + ms
  while (Date.now() < pana) {
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
export async function listeazaIzolat(dir: string, prima: string, ms = TIMP_LISTARE_MS): Promise<{ code: number; out: string; err: string }> {
  await Deno.writeTextFile(`${dir}/prima`, prima)
  await scrieAtomic(`${dir}/cerere`, 'l')
  if (!await asteapta(`${dir}/rasp/listare.gata`, ms)) return { code: -1, out: '', err: 'extractorul izolat (gazpet-seap-extractor) nu a răspuns la listare — e pornit?' }
  const code = Number((await Deno.readTextFile(`${dir}/rasp/listare.cod`)).trim())
  const out = await Deno.readTextFile(`${dir}/rasp/listare.txt`)
  const err = await Deno.readTextFile(`${dir}/rasp/listare.err`).catch(() => '')
  return { code, out, err }
}
/** Extragerea în <dir>/out, făcută de extractor DUPĂ ce listarea a fost aprobată. Cod ≠ 0 → motivul extractorului. */
export async function extrageIzolat(dir: string, ms = TIMP_EXTRAGERE_MS): Promise<{ code: number; motiv: string }> {
  await scrieAtomic(`${dir}/cerere`, 'x')
  if (!await asteapta(`${dir}/rasp/rezultat`, ms)) return { code: -1, motiv: 'extractorul izolat nu a terminat în timp util' }
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
export async function listaSeap(cNotice: number, tip: number): Promise<{ docs: DocSeap[]; cookie: string }> {
  const r = await fetch(`${SEAP}/NoticeCommon/GetDfNoticeSectionFiles/?initNoticeId=${cNotice}&sysNoticeTypeId=${tip}`, { headers: SEAP_HDR })
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

export async function descarca(doc: DocSeap, cookie: string, tinta: string): Promise<number> {
  const link = doc.url.startsWith('http') ? doc.url : `https://e-licitatie.ro/${doc.url.replace(/^\/+/, '')}`
  const r = await fetch(link, { headers: cookie ? { ...SEAP_HDR, Cookie: cookie } : SEAP_HDR })
  if (!r.ok || !r.body) throw new Error(`descărcare HTTP ${r.status}`)
  const f = await Deno.open(tinta, { write: true, create: true, truncate: true })
  await r.body.pipeTo(f.writable)                     // flux direct pe disc — fără limită de memorie
  return (await Deno.stat(tinta)).size
}

const sha256 = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map(x => x.toString(16).padStart(2, '0')).join('')

// -- Urcarea unui fișier + rândul în BD (aceleași reguli ca ofertare-seap-import) ---------------------------
async function urca(supa: Supa, licId: number, numeFinal: string, buf: Uint8Array, placeholders: Map<string, number>): Promise<string | { id: number }> {
  if (buf.length > MAX_FISIER_STORAGE) return `peste limita de stocare (${Math.round(buf.length / 2 ** 20)} MB > 200 MB)`
  const estePdf = /\.pdf$/i.test(numeFinal) || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)
  const safe = numeFinal.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180)
  const path = `${licId}/atribuire/${Date.now().toString(36)}_${safe}`
  const { error: eUp } = await supa.storage.from(BUCKET).upload(path, buf, { contentType: estePdf ? 'application/pdf' : 'application/octet-stream' })
  if (eUp) return `urcare: ${eUp.message}`
  const rand = {
    licitatie_id: licId, fisier_path: path, nume_original: numeFinal, tip: ghicesteTip(numeFinal), size_bytes: buf.length,
    status_procesare: estePdf ? 'neprocesat' : 'ignorat',
    eroare: estePdf ? null : 'non-PDF - ramane ca fisier (docx/xls se citesc cu ofertare-word-text)',
    sursa: 'seap',
  }
  const idPh = placeholders.get(cheieNume(numeFinal))
  const { data, error } = idPh
    ? await supa.from('ofertare_documente_atribuire').update(rand).eq('id', idPh).select('id').single()
    : await supa.from('ofertare_documente_atribuire').insert(rand).select('id').single()
  if (error) { await supa.storage.from(BUCKET).remove([path]); return `rând BD: ${error.message}` }
  return { id: (data as any).id as number }
}

// -- O licitație ------------------------------------------------------------------------------------
type ManifestRand = { licitatie_id: number; arhiva_cheie: string; cale: string; marime: number; sha256: string; document_id: number | null; stare: 'urcat' | 'deja_in_platforma' | 'eroare_urcare' | 'ignorat'; motiv: string | null; verificat_la: string }
type Raport = { seap: number; deja: number; adusi: number; fisiere_urcate: number; erori: string[]; sarite: number }

async function inregistreaza(supa: Supa, licId: number, nume: string, rez: { stare: 'identificat' | 'ok' | 'eroare' | 'sarit'; etapa?: string; motiv?: string; marime?: number; sha?: string; extrase?: number; faraReincercare?: boolean }) {
  const cheie = cheieNume(nume)
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
  const { data: dinBd } = await supa.from('ofertare_documente_atribuire').select('id, nume_original, fisier_path').eq('licitatie_id', licId)
  const urcate = new Map((dinBd || []).filter(d => !estePlaceholder(d)).map(d => [cheieNume(d.nume_original), d.id as number]))
  const placeholders = new Map((dinBd || []).filter(estePlaceholder).map(d => [cheieNume(d.nume_original), d.id as number]))
  const { data: evid } = await supa.from('ofertare_seap_fisiere').select('cheie, stare, incercari').eq('licitatie_id', licId)
  const evidenta = new Map((evid || []).map(e => [e.cheie, e]))

  // ce lipsește: nu e document urcat și nu e deja tratat cu succes (arhivele nu apar niciodată ca document)
  const lipsa = docs.filter(d => {
    const k = cheieNume(d.nume)
    if (urcate.has(k) || evidenta.get(k)?.stare === 'ok' || evidenta.get(k)?.stare === 'sarit') { raport.deja++; return false }
    if ((evidenta.get(k)?.incercari ?? 0) >= MAX_INCERCARI) { raport.sarite++; return false }   // motivul rămâne scris
    return true
  })
  if (!lipsa.length) return raport

  // volumele RAR ale aceleiași arhive se tratează împreună (toate sau nimic)
  const grupuri = new Map<string, DocSeap[]>()
  for (const d of lipsa) {
    const v = volumRar(d.nume.replace(/\.p7s$/i, ''))
    const cheieGrup = v ? `rar:${v.baza.toLowerCase()}` : `f:${d.nume}`
    grupuri.set(cheieGrup, [...(grupuri.get(cheieGrup) || []), d])
  }
  // un volum lipsă din grup (ex. partea 3 deja „ok"?) → luăm tot grupul din lista completă SEAP
  for (const [k, g] of grupuri) {
    if (!k.startsWith('rar:')) continue
    const toate = docs.filter(d => { const v = volumRar(d.nume.replace(/\.p7s$/i, '')); return v && `rar:${v.baza.toLowerCase()}` === k })
    grupuri.set(k, toate)
  }

  await Deno.mkdir(LUCRU, { recursive: true })
  // etapa 1: identificat — rămâne vizibil „în curs” dacă jobul moare înainte de rezultat (poarta: „încă în curs de aducere”)
  for (const g of grupuri.values()) for (const d of g) {
    const k = cheieNume(d.nume)
    if (evidenta.get(k)?.stare !== 'eroare') await inregistreaza(supa, licId, d.nume, { stare: 'identificat', etapa: 'identificare' })
  }
  const tmp = await Deno.makeTempDir({ dir: LUCRU, prefix: `seap_${licId}_` })
  await Deno.chmod(tmp, 0o755)
  try {
    for (const [cheieGrup, grup] of grupuri) {
      const eticheta = grup.length > 1 ? `${grup[0].nume.replace(/\.part\d+\.rar(\.p7s)?$/i, '')} (${grup.length} volume)` : grup[0].nume
      stare(`aduc ${eticheta}`)
      const dir = `${tmp}/${raport.adusi++}`
      await pregatesteJob(dir)
      const locale: { doc: DocSeap; nume: string; cale: string; marime: number; sha: string }[] = []
      let esec: string | null = null, etapaEsec = 'descarcare'
      // cifrele numărului de volum din SEAP (part01 → 2) — numele canonic trebuie să le păstreze
      const cifre = Math.max(1, ...grup.map(d => d.nume.match(/\.part(\d+)/i)?.[1].length ?? 1))
      grup.sort((a, b) => (volumRar(a.nume.replace(/\.p7s$/i, ''))?.nr ?? 0) - (volumRar(b.nume.replace(/\.p7s$/i, ''))?.nr ?? 0))
      for (const doc of grup) {
        try {
          const brut = `${dir}/in/descarcat.bin`
          await descarca(doc, cookie, brut)
          let buf = await Deno.readFile(brut)
          let nume = doc.nume
          if (/\.p7s$/i.test(nume)) { buf = continutP7s(buf); nume = nume.replace(/\.p7s$/i, '') }
          const vol = cheieGrup.startsWith('rar:') ? volumRar(nume) : null
          const cale = `${dir}/in/${(vol ? numeVolum(vol, cifre) : nume).replace(/[\\/]/g, '_')}`
          await Deno.writeFile(cale, buf)
          await Deno.remove(brut)
          locale.push({ doc, nume, cale, marime: buf.length, sha: await sha256(buf) })
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
          const buf = await Deno.readFile(f.cale)
          const rand: ManifestRand = { licitatie_id: licId, arhiva_cheie: arhivaCheie, cale: f.rel, marime: buf.length, sha256: await sha256(buf), document_id: null, stare: 'urcat', motiv: null, verificat_la: new Date().toISOString() }
          if (JUNK_RE.test(f.rel)) { rand.stare = 'ignorat'; rand.motiv = 'fișier de sistem (junk)' }
          else if (urcate.has(cheieNume(f.rel))) { extrase++; rand.stare = 'deja_in_platforma'; rand.document_id = urcate.get(cheieNume(f.rel)) ?? null }   // ex. urcat de mână
          else {
            stare(`urc ${f.rel}`)
            const r = await urca(supa, licId, f.rel, buf, placeholders)
            if (typeof r === 'string') { eroriInterne.push(`${f.rel}: ${r}`); rand.stare = 'eroare_urcare'; rand.motiv = r }
            else { extrase++; raport.fisiere_urcate++; urcate.set(cheieNume(f.rel), r.id); rand.document_id = r.id }
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
          const idPh = placeholders.get(cheieNume(l.doc.nume))
          if (idPh) await supa.from('ofertare_documente_atribuire').update({ eroare: `Arhivă adusă pe Terra: ${extrase} fișiere în platformă${motiv ? ' — ' + motiv : ''}.` }).eq('id', idPh)
        }
      } else {
        // FIȘIER SIMPLU
        const l = locale[0]
        const buf = await Deno.readFile(l.cale)
        const r = await urca(supa, licId, l.nume, buf, placeholders)
        await Deno.remove(l.cale)
        if (typeof r === 'string') { raport.erori.push(`${l.nume}: ${r}`); await inregistreaza(supa, licId, l.doc.nume, { stare: 'eroare', etapa: 'urcare', motiv: r, marime: l.marime, sha: l.sha }) }
        else { raport.fisiere_urcate++; urcate.set(cheieNume(l.nume), r.id); await inregistreaza(supa, licId, l.doc.nume, { stare: 'ok', etapa: 'urcare', marime: l.marime, sha: l.sha, extrase: 1 }) }
      }
      await Deno.remove(dir, { recursive: true }).catch(() => {})
    }
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {})
  }
  return raport
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
  const { data: cereri } = await supa.from('ofertare_seap_cereri').select('licitatie_id, cerut_la, terminat_la, cerut_de, sursa').order('cerut_la').limit(20)
  for (const c of cereri || []) {
    if (oprire()) return
    if (c.terminat_la && new Date(c.terminat_la) >= new Date(c.cerut_la)) continue
    await supa.from('ofertare_seap_cereri').update({ preluat_la: new Date().toISOString() }).eq('licitatie_id', c.licitatie_id)
    let raport: Raport | { eroare: string }
    try {
      raport = await aduLicitatie(supa, c.licitatie_id, s => stare(`#${c.licitatie_id} ${s}`))
      log(`#${c.licitatie_id}: SEAP ${raport.seap}, deja ${raport.deja}, urcate ${raport.fisiere_urcate}, erori ${raport.erori.length}`)
    } catch (e) {
      raport = { eroare: String((e as Error)?.message ?? e) }
      log(`#${c.licitatie_id}: eșec — ${raport.eroare}`)
    }
    await supa.from('ofertare_seap_cereri').update({ terminat_la: new Date().toISOString(), raport }).eq('licitatie_id', c.licitatie_id)
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
}
